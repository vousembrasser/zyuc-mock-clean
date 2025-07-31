package bus

import (
	"log"
	"sync"
)

// JsonEventBus manages a set of subscribers and broadcasts messages to them.
type JsonEventBus struct {
	// The map now stores the mode of the subscriber ("interactive" or "keep-alive")
	subscribers map[chan string]string
	mu          sync.RWMutex
}

// NewJsonEventBus creates a new JsonEventBus.
func New() *JsonEventBus {
	return &JsonEventBus{
		subscribers: make(map[chan string]string),
	}
}

// Subscribe adds a new subscriber to the event bus with a specific mode.
func (bus *JsonEventBus) Subscribe(mode string) chan string {
	bus.mu.Lock()
	defer bus.mu.Unlock()
	ch := make(chan string, 1) // Use a buffered channel
	bus.subscribers[ch] = mode
	log.Printf("bus: New client subscribed with mode: %s.", mode)
	return ch
}

// Unsubscribe removes a subscriber from the event bus.
func (bus *JsonEventBus) Unsubscribe(ch chan string) {
	bus.mu.Lock()
	defer bus.mu.Unlock()
	if _, ok := bus.subscribers[ch]; ok {
		delete(bus.subscribers, ch)
		close(ch)
		log.Println("bus: Client unsubscribed.")
	}
}

// Publish sends a JSON string message ONLY to "interactive" subscribers.
func (bus *JsonEventBus) Publish(jsonMessage string) {
	bus.mu.RLock()
	defer bus.mu.RUnlock()

	interactiveSubscribers := 0
	for ch, mode := range bus.subscribers {
		if mode == "interactive" {
			select {
			case ch <- jsonMessage:
				interactiveSubscribers++
			default:
				log.Printf("bus: Interactive subscriber channel full. Message dropped.")
			}
		}
	}
	log.Printf("bus: Published message to %d interactive subscribers", interactiveSubscribers)
}

// InteractiveSubscriberCount returns the number of subscribers in "interactive" mode.
func (bus *JsonEventBus) InteractiveSubscriberCount() int {
	bus.mu.RLock()
	defer bus.mu.RUnlock()
	count := 0
	for _, mode := range bus.subscribers {
		if mode == "interactive" {
			count++
		}
	}
	return count
}
