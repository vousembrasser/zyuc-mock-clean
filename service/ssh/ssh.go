package ssh

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"mock.com/zyuc-mock-clean/service/bus"
	"mock.com/zyuc-mock-clean/storage"
)

// SSHServer holds the components for the SSH mock server.
type SSHServer struct {
	bus    *bus.JsonEventBus
	db     *storage.DB
	config *ssh.ServerConfig
}

// NewSSHServer creates a new SSH server instance.
func NewSSHServer(bus *bus.JsonEventBus, db *storage.DB, privateKey string) (*SSHServer, error) {
	privateBytes := []byte(privateKey)
	private, err := ssh.ParsePrivateKey(privateBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	config := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			return nil, nil
		},
	}
	config.AddHostKey(private)

	return &SSHServer{
		bus:    bus,
		db:     db,
		config: config,
	}, nil
}

// Start listens for and handles incoming SSH connections.
func (s *SSHServer) Start(listenAddr string) {
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Fatalf("Failed to listen for SSH connections: %v", err)
	}
	log.Printf("SSH server listening on %s", listenAddr)

	go func() {
		for {
			nConn, err := listener.Accept()
			if err != nil {
				log.Printf("Failed to accept incoming SSH connection: %v", err)
				continue
			}
			go s.handleConnection(nConn)
		}
	}()
}

// handleConnection manages an individual SSH connection.
func (s *SSHServer) handleConnection(nConn net.Conn) {
	conn, chans, reqs, err := ssh.NewServerConn(nConn, s.config)
	if err != nil {
		log.Printf("Failed to handshake: %v", err)
		return
	}
	defer conn.Close()
	log.Printf("New SSH connection from %s (%s)", conn.RemoteAddr(), conn.ClientVersion())

	go ssh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
			continue
		}
		channel, requests, err := newChannel.Accept()
		if err != nil {
			log.Printf("Could not accept channel: %v", err)
			continue
		}

		go func(in <-chan *ssh.Request) {
			for req := range in {
				switch req.Type {
				case "shell", "pty-req":
					req.Reply(true, nil)
					if req.Type == "shell" {
						go s.handleShell(channel)
					}
				default:
					req.Reply(false, nil)
				}
			}
		}(requests)
	}
}

// handleShell manages an interactive shell session for an SSH connection.
func (s *SSHServer) handleShell(channel ssh.Channel) {
	defer channel.Close()
	term := &mockTerminal{
		sshChannel:  channel,
		bus:         s.bus,
		db:          s.db,
		pendingReqs: make(map[string]chan string),
	}
	term.Run()
}

type mockTerminal struct {
	sshChannel    ssh.Channel
	bus           *bus.JsonEventBus
	db            *storage.DB
	pendingReqs   map[string]chan string
	pendingReqsMu sync.Mutex
}

// Run starts the interactive terminal session, reading commands char by char.
func (t *mockTerminal) Run() {
	t.sshChannel.Write([]byte("Welcome to the ZYUC Mock SSH server!\r\n"))

	var line []byte
	buffer := make([]byte, 1)

	for {
		t.sshChannel.Write([]byte("> "))
		line = nil // Reset line buffer for new command

		for {
			n, err := t.sshChannel.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Printf("Error reading from SSH channel: %v", err)
				}
				return // End session on error or EOF
			}
			if n == 0 {
				continue
			}

			char := buffer[0]

			// Handle Enter key (CR or LF)
			if char == '\r' || char == '\n' {
				t.sshChannel.Write([]byte("\r\n")) // Echo newline
				command := strings.TrimSpace(string(line))

				if command == "exit" {
					t.sshChannel.Write([]byte("Goodbye!\r\n"))
					return // End session
				}

				if command != "" {
					t.handleCommand(command)
				}
				break // Break inner loop to show new prompt
			}

			// Handle Backspace
			if char == 127 || char == 8 { // 127 is DEL, 8 is BS
				if len(line) > 0 {
					line = line[:len(line)-1]
					t.sshChannel.Write([]byte("\b \b")) // Erase char on client terminal
				}
				continue
			}

			// Echo printable characters
			if char >= 32 && char < 127 {
				line = append(line, char)
				t.sshChannel.Write(buffer[:n])
			}
		}
	}
}

// handleCommand processes a single command received from the terminal.
func (t *mockTerminal) handleCommand(command string) {
	reqID := uuid.New().String()
	sshConfig, _ := t.db.GetSshConfigForCommand(command)

	var responseToSend string
	var project string
	if sshConfig != nil {
		responseToSend = sshConfig.Response
		project = sshConfig.Project
	} else {
		responseToSend = fmt.Sprintf("Command '%s' not found.", command)
	}

	if err := t.db.CreateSshEvent(reqID, command, project, "", "Pending"); err != nil {
		log.Printf("Failed to save pending SSH event: %v", err)
	}

	responseChan := make(chan string, 1)

	t.pendingReqsMu.Lock()
	t.pendingReqs[reqID] = responseChan
	t.pendingReqsMu.Unlock()

	defer func() {
		t.pendingReqsMu.Lock()
		delete(t.pendingReqs, reqID)
		t.pendingReqsMu.Unlock()
	}()

	ssePayload := map[string]string{
		"requestId":       reqID,
		"command":         command,
		"project":         project,
		"defaultResponse": responseToSend,
		"type":            "ssh",
	}

	ssePayloadJSON, _ := json.Marshal(ssePayload)
	t.bus.Publish(string(ssePayloadJSON))

	select {
	case responseBody := <-responseChan:
		log.Printf("Responding to SSH command %s with user response.", reqID)
		t.db.UpdateSshEventResponse(reqID, responseBody, "Responded (Custom)")
		t.sshChannel.Write([]byte(responseBody + "\r\n"))
	case <-time.After(0 * time.Second):
		log.Printf("SSH command %s timed out after 0 seconds.", reqID)
		t.db.UpdateSshEventResponse(reqID, responseToSend, "Auto-Responded")
		t.sshChannel.Write([]byte(responseToSend + "\r\n"))
	}
}
