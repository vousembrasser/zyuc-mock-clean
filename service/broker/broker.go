package broker

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"mock.com/zyuc-mock-clean/service/bus"
	"mock.com/zyuc-mock-clean/storage"
)

type PendingRequest struct {
	ResponseChan    chan string
	Endpoint        string
	DefaultResponse string
}

type EventBroker struct {
	bus           *bus.JsonEventBus
	db            *storage.DB
	pendingReqs   map[string]*PendingRequest
	pendingReqsMu sync.Mutex
	serverAddr    string
}

func New(db *storage.DB, serverAddr string) *EventBroker {
	return &EventBroker{
		bus:         bus.New(),
		db:          db,
		pendingReqs: make(map[string]*PendingRequest),
		serverAddr:  serverAddr,
	}
}

func (b *EventBroker) HandlePublish(c *gin.Context) {
	bodyData, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
		return
	}
	
	bodyString := string(bodyData)
	if bodyString == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request body is empty"})
		return
	}

	source := b.serverAddr
	endpoint := c.Request.URL.Path

	config, _ := b.db.GetConfigForRequest(endpoint, source)

	responseToSend := `<?xml version="1.0" encoding="UTF-8"?><response><status>SUCCESS</status><message>Global default mock response.</message></response>`
	
	if config != nil {
		responseToSend = config.DefaultResponse
		for _, rule := range config.Rules {
			if strings.Contains(bodyString, rule.Keyword) {
				responseToSend = rule.Response
				log.Printf("broker: Matched keyword '%s' for endpoint '%s'. Responding with specific rule.", rule.Keyword, endpoint)
				break
			}
		}
	}

	reqID := uuid.New().String()
	project := ""
	if config != nil {
		project = config.Project
	}

	if b.bus.InteractiveSubscriberCount() == 0 {
		log.Printf("broker: No UI clients. Responding immediately for %s.", endpoint)
		if err := b.db.CreateEvent(reqID, endpoint, project, bodyString, responseToSend, "Auto-Responded", source); err != nil {
			log.Printf("broker: Failed to save auto-responded event: %v", err)
		}
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(responseToSend))
		return
	}

	if err := b.db.CreateEvent(reqID, endpoint, project, bodyString, "", "Pending", source); err != nil {
		log.Printf("broker: Failed to save pending event: %v", err)
	}

	pr := &PendingRequest{
		ResponseChan:    make(chan string),
		Endpoint:        endpoint,
		DefaultResponse: responseToSend,
	}

	b.pendingReqsMu.Lock()
	b.pendingReqs[reqID] = pr
	b.pendingReqsMu.Unlock()

	defer func() {
		b.pendingReqsMu.Lock()
		delete(b.pendingReqs, reqID)
		b.pendingReqsMu.Unlock()
	}()

	ssePayload := map[string]string{
		"requestId":       reqID,
		"payload":         bodyString,
		"endpoint":        endpoint,
		"defaultResponse": responseToSend,
		"project":         project,
		"source":          source,
	}
	ssePayloadJSON, _ := json.Marshal(ssePayload)
	b.bus.Publish(string(ssePayloadJSON))

	select {
	case responseBody := <-pr.ResponseChan:
		log.Printf("broker: Responding to request %s.", reqID)
		status := "Responded"
		if responseBody == responseToSend {
			currentStatus, _ := b.db.GetEventStatus(reqID)
			if currentStatus == "Pending" {
				status = "Responded (Default)"
			} else {
				status = currentStatus
			}
		}
		b.db.UpdateEventResponse(reqID, responseBody, status)
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(responseBody))
	case <-time.After(10 * time.Second):
		log.Printf("broker: Request %s timed out.", reqID)
		b.db.UpdateEventResponse(reqID, responseToSend, "Timed Out")
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(responseToSend))
	case <-c.Request.Context().Done():
		log.Printf("broker: Caller for request %s disconnected.", reqID)
		b.db.UpdateEventResponse(reqID, "", "Cancelled")
	}
}

// THE FIX: This handler now expects the configID in the request body, not the URL.
func (b *EventBroker) HandleAddRule(c *gin.Context) {
	var req struct {
		ConfigID uint   `json:"configID"`
		Keyword  string `json:"keyword"`
		Response string `json:"response"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Keyword == "" || req.ConfigID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: configID and keyword cannot be empty"})
		return
	}

	rule, err := b.db.AddRuleToConfig(req.ConfigID, req.Keyword, req.Response)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add rule"})
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (b *EventBroker) HandleDeleteRule(c *gin.Context) {
	ruleID, err := strconv.Atoi(c.Param("ruleID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid rule ID"})
		return
	}

	if err := b.db.DeleteRule(uint(ruleID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete rule"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "Rule deleted successfully"})
}

func (b *EventBroker) HandleGetConfig(c *gin.Context) {
	endpoint := c.Param("endpoint")
	config, err := b.db.GetConfigByEndpoint(endpoint)
	if err != nil {
		log.Printf("broker: Failed to get config for endpoint %s: %v", endpoint, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve configuration"})
		return
	}
	if config == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Configuration not found"})
		return
	}
	c.JSON(http.StatusOK, config)
}

func (b *EventBroker) HandleGetConfigSources(c *gin.Context) {
	sources, err := b.db.GetAllConfigSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve config sources"})
		return
	}
    if sources == nil {
        sources = make([]string, 0)
    }
	c.JSON(http.StatusOK, sources)
}

func (b *EventBroker) HandleSetConfig(c *gin.Context) {
	var req struct {
		Endpoint        string `json:"endpoint"`
		Project         string `json:"project"`
		Remark          string `json:"remark"`
		DefaultResponse string `json:"defaultResponse"`
		Source          string `json:"source"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format: " + err.Error()})
		return
	}
	if req.Endpoint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Endpoint cannot be empty"})
		return
	}
	if err := b.db.SetConfig(req.Endpoint, req.Project, req.Remark, req.DefaultResponse, req.Source); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save configuration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "Configuration saved successfully"})
}

func (b *EventBroker) HandleGetConfigs(c *gin.Context) {
	configs, err := b.db.GetAllConfigs()
	if err != nil {
		log.Printf("broker: Failed to get all configs: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve configurations"})
		return
	}
	c.JSON(http.StatusOK, configs)
}

func (b *EventBroker) HandleGetHistory(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	project := c.Query("project")
	search := c.Query("search")
	source := c.Query("source")

	events, total, err := b.db.GetEvents(page, pageSize, project, search, source)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":     events,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

func (b *EventBroker) HandleGetHistorySources(c *gin.Context) {
	sources, err := b.db.GetAllEventSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve history sources"})
		return
	}
    if sources == nil {
        sources = make([]string, 0)
    }
	c.JSON(http.StatusOK, sources)
}

func (b *EventBroker) HandleGetServices(c *gin.Context) {
	activeServices, err := b.db.GetActiveServiceInstances(10 * time.Second)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve active services"})
		return
	}
	c.JSON(http.StatusOK, activeServices)
}

func (b *EventBroker) CleanupPendingRequests() {
	b.pendingReqsMu.Lock()
	defer b.pendingReqsMu.Unlock()
	if len(b.pendingReqs) == 0 {
		return
	}
	log.Printf("Cleaning up %d pending requests...", len(b.pendingReqs))
	for reqID, pr := range b.pendingReqs {
		log.Printf("Auto-responding to pending request %s", reqID)
		pr.ResponseChan <- pr.DefaultResponse
		b.db.UpdateEventResponse(reqID, pr.DefaultResponse, "Auto-Responded (Disconnect)")
	}
	b.pendingReqs = make(map[string]*PendingRequest)
}

func (b *EventBroker) HandleSSEConnection(c *gin.Context) {
	mode := c.DefaultQuery("mode", "keep-alive")
	messageChan := b.bus.Subscribe(mode)
	defer func() {
		b.bus.Unsubscribe(messageChan)
		if mode == "interactive" && b.bus.InteractiveSubscriberCount() == 0 {
			b.CleanupPendingRequests()
		}
	}()

	c.SSEvent("connected", `{"status": "ok"}`)
	c.Writer.Flush()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	c.Stream(func(w io.Writer) bool {
		select {
		case msg, ok := <-messageChan:
			if !ok {
				return false
			}
			c.SSEvent("message", msg)
			return true
		case <-ticker.C:
			c.SSEvent("ping", "keep-alive")
			return true
		case <-c.Request.Context().Done():
			return false
		}
	})
}

func (b *EventBroker) HandleRespond(c *gin.Context) {
	var req struct {
		RequestID    string `json:"requestId"`
		ResponseBody string `json:"responseBody"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}
	b.pendingReqsMu.Lock()
	pendingReq, ok := b.pendingReqs[req.RequestID]
	b.pendingReqsMu.Unlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request ID not found or already processed"})
		return
	}
	pendingReq.ResponseChan <- req.ResponseBody
	c.JSON(http.StatusOK, gin.H{"status": "Response sent to original caller"})
}

func (b *EventBroker) HandleDeleteConfig(c *gin.Context) {
	endpoint := c.Param("endpoint")
	if err := b.db.DeleteConfig(endpoint); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete configuration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "Configuration deleted successfully"})
}