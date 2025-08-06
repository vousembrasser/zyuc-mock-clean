package sse

import (
	"fmt"
	"net/http"
	"time"
)

// NewManager creates a new SSE Manager instance.
func NewManager() *Manager {
	return &Manager{
		clients: make(map[string]*Client),
	}
}

// AddClient adds a new client connection to the manager.
func (m *Manager) AddClient(id string, client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.clients[id] = client
}

// RemoveClient removes a client connection from the manager.
func (m *Manager) RemoveClient(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.clients, id)
}

// CreateConnection creates a new SSE connection for a client.
func (m *Manager) CreateConnection(w http.ResponseWriter, r *http.Request, id string) {
	// Set the appropriate HTTP headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*") // Adjust CORS as needed

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	// Create a new client and add to the manager
	client := &Client{
		ID:    id,
		Event: make(chan []byte, 10), // Buffered channel to prevent blocking
	}
	m.AddClient(id, client)

	// Clean up when the connection is closed
	defer func() {
		m.RemoveClient(id)
		close(client.Event)
		fmt.Printf("Client %s disconnected.\n", id)
	}()

	fmt.Printf("Client %s connected.\n", id)

	// Start a loop to send messages to the client
	for {
		select {
		case msg, ok := <-client.Event:
			if !ok {
				// Channel closed, break the loop
				return
			}
			// Write the SSE data to the client
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-r.Context().Done():
			// Client disconnected
			return
		}
	}
}

// SendToClient sends a message to a specific client by ID.
func (m *Manager) SendToClient(id string, data []byte) error {
	m.mu.RLock()
	client, ok := m.clients[id]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("client with ID %s not found", id)
	}

	// Non-blocking send
	select {
	case client.Event <- data:
	default:
		// Handle case where client's channel is full
		fmt.Printf("Client %s channel is full, dropping message.\n", id)
	}

	return nil
}

// Broadcast sends a message to all connected clients.
func (m *Manager) Broadcast(data []byte) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, client := range m.clients {
		// Non-blocking send
		select {
		case client.Event <- data:
		default:
			// Handle case where client's channel is full
			fmt.Printf("Client %s channel is full, dropping broadcast message.\n", client.ID)
		}
	}
}

// StartHeartbeat sends a heartbeat message to all clients at a regular interval.
func (m *Manager) StartHeartbeat(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			m.Broadcast([]byte("heartbeat"))
		}
	}()
}
