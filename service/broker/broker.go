package broker

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"mock.com/zyuc-mock-clean/service/bus"
	"mock.com/zyuc-mock-clean/storage"
)

// ... (structs and New function) ...
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
}

func New(db *storage.DB) *EventBroker {
	return &EventBroker{
		bus:         bus.New(),
		db:          db,
		pendingReqs: make(map[string]*PendingRequest),
	}
}


// HandleSSEConnection with connected and ping events
func (b *EventBroker) HandleSSEConnection(c *gin.Context) {
	mode := c.DefaultQuery("mode", "keep-alive")
	messageChan := b.bus.Subscribe(mode)
	defer func() {
		b.bus.Unsubscribe(messageChan)
		if mode == "interactive" && b.bus.InteractiveSubscriberCount() == 0 {
			b.CleanupPendingRequests()
		}
	}()

	// 1. Immediately send a 'connected' event
	c.SSEvent("connected", `{"status": "ok"}`)
	c.Writer.Flush()

	// 2. Create a ticker for periodic ping events (heartbeat)
	ticker := time.NewTicker(15 * time.Second) // 15 seconds is a good interval
	defer ticker.Stop()

	c.Stream(func(w io.Writer) bool {
		select {
		case msg, ok := <-messageChan:
			if !ok {
				return false // Channel closed
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

// ... (Rest of the file: CleanupPendingRequests, HandlePublish, etc. remains the same) ...
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

func (b *EventBroker) HandlePublish(c *gin.Context) {
	bodyData, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
		return
	}
	if len(bodyData) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request body is empty"})
		return
	}

	config, _ := b.db.GetConfig(c.Request.URL.Path)
	defaultResponse := `<?xml version="1.0" encoding="UTF-8"?><response><status>SUCCESS</status><message>Global default mock response.</message></response>`
	if config != nil && config.DefaultResponse != "" {
		defaultResponse = config.DefaultResponse
	}

	reqID := uuid.New().String()
	project := ""
	if config != nil {
		project = config.Project
	}

	if b.bus.InteractiveSubscriberCount() == 0 {
		log.Printf("broker: No interactive UI clients. Responding immediately for %s", c.Request.URL.Path)
		if err := b.db.CreateEvent(reqID, c.Request.URL.Path, project, string(bodyData), defaultResponse, "Auto-Responded"); err != nil {
			log.Printf("broker: Failed to save auto-responded event: %v", err)
		}
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(defaultResponse))
		return
	}

	if err := b.db.CreateEvent(reqID, c.Request.URL.Path, project, string(bodyData), "", "Pending"); err != nil {
		log.Printf("broker: Failed to save pending event: %v", err)
	}

	pr := &PendingRequest{
		ResponseChan:    make(chan string),
		Endpoint:        c.Request.URL.Path,
		DefaultResponse: defaultResponse,
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
		"payload":         string(bodyData),
		"endpoint":        c.Request.URL.Path,
		"defaultResponse": defaultResponse,
		"project":         project,
	}
	ssePayloadJSON, _ := json.Marshal(ssePayload)
	b.bus.Publish(string(ssePayloadJSON))

	select {
	case responseBody := <-pr.ResponseChan:
		log.Printf("broker: Responding to request %s.", reqID)
		status := "Responded"
		if responseBody == defaultResponse {
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
		b.db.UpdateEventResponse(reqID, defaultResponse, "Timed Out")
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(defaultResponse))
	case <-c.Request.Context().Done():
		log.Printf("broker: Caller for request %s disconnected.", reqID)
		b.db.UpdateEventResponse(reqID, "", "Cancelled")
	}
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

func (b *EventBroker) HandleSetConfig(c *gin.Context) {
	var req struct {
		Endpoint        string `json:"endpoint"`
		Project         string `json:"project"`
		Remark          string `json:"remark"`
		DefaultResponse string `json:"defaultResponse"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format: " + err.Error()})
		return
	}
	if req.Endpoint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Endpoint cannot be empty"})
		return
	}
	if err := b.db.SetConfig(req.Endpoint, req.Project, req.Remark, req.DefaultResponse); err != nil {
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

func (b *EventBroker) HandleGetConfig(c *gin.Context) {
	endpoint := c.Param("endpoint")
	config, err := b.db.GetConfig(endpoint)
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

func (b *EventBroker) HandleDeleteConfig(c *gin.Context) {
	endpoint := c.Param("endpoint")
	if err := b.db.DeleteConfig(endpoint); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete configuration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "Configuration deleted successfully"})
}

func (b *EventBroker) HandleGetHistory(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	project := c.Query("project")
	search := c.Query("search")

	events, total, err := b.db.GetEvents(page, pageSize, project, search)
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