package broker

import (
	"bytes"
	"crypto/tls"
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
	httpClient    *http.Client
}

func New(db *storage.DB, serverAddr string, useHTTPS bool) *EventBroker {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	return &EventBroker{
		bus:         bus.New(),
		db:          db,
		pendingReqs: make(map[string]*PendingRequest),
		serverAddr:  serverAddr,
		httpClient:  &http.Client{Timeout: 15 * time.Second, Transport: tr}, // 增加超时以适应等待
	}
}

func (b *EventBroker) isPrimary() (bool, *storage.ServiceInstance) {
	primary, err := b.db.GetPrimaryServiceInstance(10 * time.Second)
	if err != nil {
		log.Printf("broker: Could not determine primary service: %v", err)
		return false, nil
	}
	if primary == nil {
		return false, nil
	}
	return primary.Address == b.serverAddr, primary
}

// HandlePublish - 新的调度器/代理逻辑
func (b *EventBroker) HandlePublish(c *gin.Context) {
	isPrimary, primaryNode := b.isPrimary()
	if isPrimary {
		// 如果是主节点，直接调用核心处理逻辑
		b.handleCentralPublish(c)
		return
	}

	// 如果不是主节点，则将请求代理给主节点
	if primaryNode == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "No primary service available to handle the request."})
		return
	}

	// 读取原始请求体
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
		return
	}

	// 构建转发请求
	url := primaryNode.Protocol + "://" + primaryNode.Address + c.Request.URL.Path
	proxyReq, err := http.NewRequest(c.Request.Method, url, bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("Failed to create proxy request: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
		return
	}

	// 复制头信息，并添加源地址
	proxyReq.Header = c.Request.Header
	proxyReq.Header.Set("X-Forwarded-For-Service", b.serverAddr)

	// 发送请求并等待主节点响应
	resp, err := b.httpClient.Do(proxyReq)
	if err != nil {
		log.Printf("Failed to proxy request to primary: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to proxy request to primary"})
		return
	}
	defer resp.Body.Close()

	// 将主节点的响应写回给原始客户端
	respBody, _ := io.ReadAll(resp.Body)
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), respBody)
}

// handleCentralPublish - 这是现在只在主节点上运行的核心逻辑
func (b *EventBroker) handleCentralPublish(c *gin.Context) {
	// 确定请求源地址。如果是被转发的，则使用头信息；否则使用当前服务地址。
	source := c.GetHeader("X-Forwarded-For-Service")
	if source == "" {
		source = b.serverAddr
	}

	bodyData, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
		return
	}
	bodyString := string(bodyData)
	endpoint := c.Request.URL.Path

	config, _ := b.db.GetConfigForRequest(endpoint, source)
	responseToSend := `{"code": 200, "message": "Global default mock response."}`
	if config != nil {
		responseToSend = config.DefaultResponse
		// ... rule matching logic ...
	}

	reqID := uuid.New().String()
	project := ""
	if config != nil {
		project = config.Project
	}

	// **关键决策点**: 主节点检查真实的UI客户端连接数
	if b.bus.InteractiveSubscriberCount() == 0 {
		log.Printf("broker [primary]: No UI clients. Responding immediately for request from %s.", source)
		b.db.CreateEvent(reqID, endpoint, project, bodyString, responseToSend, "Auto-Responded", source)
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(responseToSend))
		return
	}
	
	// 如果有UI客户端，则进入3秒等待流程
	log.Printf("broker [primary]: UI client detected. Delaying response for request from %s.", source)
	if err := b.db.CreateEvent(reqID, endpoint, project, bodyString, "", "Pending", source); err != nil {
		log.Printf("broker: Failed to save pending event: %v", err)
	}

	pr := &PendingRequest{
		ResponseChan:    make(chan string),
		DefaultResponse: responseToSend,
	}

	// 注意：PendingRequest现在只存在于主节点的内存中
	b.pendingReqsMu.Lock()
	b.pendingReqs[reqID] = pr
	b.pendingReqsMu.Unlock()

	defer func() {
		b.pendingReqsMu.Lock()
		delete(b.pendingReqs, reqID)
		b.pendingReqsMu.Unlock()
	}()

	ssePayload := map[string]string{
		"requestId":       reqID, "payload": bodyString, "endpoint": endpoint,
		"defaultResponse": responseToSend, "project": project, "source": source,
	}
	ssePayloadJSON, _ := json.Marshal(ssePayload)
	b.bus.Publish(string(ssePayloadJSON))

	select {
	case responseBody := <-pr.ResponseChan:
		log.Printf("broker [primary]: Responding to request %s with user response.", reqID)
		b.db.UpdateEventResponse(reqID, responseBody, "Responded (Custom)")
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(responseBody))
	case <-time.After(0 * time.Second):
		log.Printf("broker [primary]: Request %s timed out after 3 seconds.", reqID)
		b.db.UpdateEventResponse(reqID, responseToSend, "Auto-Responded")
		c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(responseToSend))
	case <-c.Request.Context().Done():
		log.Printf("broker [primary]: Caller for request %s disconnected.", reqID)
		b.db.UpdateEventResponse(reqID, "", "Cancelled")
	}
}


// HandleRespond - 现在只会被主节点调用
func (b *EventBroker) HandleRespond(c *gin.Context) {
	isPrimary, _ := b.isPrimary()
	if !isPrimary {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the primary broker can handle responses."})
		return
	}
	
	var req struct {
		RequestID    string `json:"requestId"`
		ResponseBody string `json:"responseBody"`
		Source       string `json:"source,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	b.pendingReqsMu.Lock()
	pendingReq, ok := b.pendingReqs[req.RequestID]
	b.pendingReqsMu.Unlock()

	if !ok {
		log.Printf("broker [primary]: Request ID %s not found in pending requests.", req.RequestID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Request ID not found or already processed"})
		return
	}
	
	// 主节点直接通过通道唤醒正在等待的 handleCentralPublish 协程
	pendingReq.ResponseChan <- req.ResponseBody
	c.JSON(http.StatusOK, gin.H{"status": "Response processed by primary."})
}

// ... 其他所有非 HandlePublish 和 HandleRespond 的函数保持不变 ...
// ... (此处省略未修改的函数代码)
func (b *EventBroker) HandleForwardedEvent(c *gin.Context) {
	isPrimary, _ := b.isPrimary()
	if !isPrimary {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not the primary broker"})
		return
	}
	bodyData, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read forwarded event body"})
		return
	}
	b.bus.Publish(string(bodyData))
	c.JSON(http.StatusOK, gin.H{"status": "event forwarded successfully"})
}
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
    primary, err := b.db.GetPrimaryServiceInstance(10 * time.Second)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve primary service"})
        return
    }

    activeServices, err := b.db.GetActiveServiceInstances(10 * time.Second)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve active services"})
        return
    }

    primaryAddr := ""
    if primary != nil {
        primaryAddr = primary.Address
    }

    c.JSON(http.StatusOK, gin.H{
        "primary":  primaryAddr,
        "services": activeServices,
    })
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
    isPrimary, _ := b.isPrimary()
    if !isPrimary {
        c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Not the primary broker. Please connect to the primary."})
        return
    }
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
func (b *EventBroker) HandleDeleteConfig(c *gin.Context) {
	endpoint := c.Param("endpoint")
	if err := b.db.DeleteConfig(endpoint); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete configuration"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "Configuration deleted successfully"})
}