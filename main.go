package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"embed"
	"encoding/pem"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"mock.com/zyuc-mock-clean/service/broker"
	"mock.com/zyuc-mock-clean/service/ssh"
	"mock.com/zyuc-mock-clean/storage"
)

//go:embed all:zyuc-mock-clean-web/out
var embeddedFiles embed.FS

func getOutboundIP() (string, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "", err
	}
	defer conn.Close()
	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String(), nil
}

// generatePrivateKey creates a new RSA private key for the SSH server.
func generatePrivateKey() (string, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", err
	}

	privateKeyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
	privateKeyPem := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privateKeyBytes,
	})

	return string(privateKeyPem), nil
}

func main() {
	listenAddr := flag.String("listen", ":8080", "Listen address (e.g., :8080)")
	sshListenAddr := flag.String("ssh-listen", "", "SSH listen address (e.g., :2222). If not provided, SSH server will not start.")
	useHTTPS := flag.Bool("https", false, "Enable HTTPS")
	certFile := flag.String("certfile", "cert.pem", "Path to SSL/TLS certificate file")
	keyFile := flag.String("keyfile", "key.pem", "Path to SSL/TLS key file")
	flag.Parse()

	protocol := "http"
	if *useHTTPS {
		protocol = "https"
	}

	host, port, err := net.SplitHostPort(*listenAddr)
	if err != nil {
		host = ""
		port = strings.TrimPrefix(*listenAddr, ":")
	}

	regHost := host
	if regHost == "" || regHost == "0.0.0.0" {
		outboundIP, err := getOutboundIP()
		if err != nil {
			log.Printf("Could not determine outbound IP, defaulting to localhost. Error: %v", err)
			regHost = "localhost"
		} else {
			regHost = outboundIP
			log.Printf("Successfully determined outbound IP for service registration: %s", regHost)
		}
	}
	regAddr := net.JoinHostPort(regHost, port)

	db, err := storage.NewDB("mock_config.db")
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := db.UpsertServiceInstance(regAddr, protocol); err != nil {
		log.Fatalf("Failed to register service instance: %v", err)
	}
	log.Printf("Service instance %s (%s) registered.", regAddr, protocol)

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := db.UpsertServiceInstance(regAddr, protocol); err != nil {
					log.Printf("Heartbeat failed for %s: %v", regAddr, err)
				}
			case <-ctx.Done():
				log.Printf("Stopping heartbeat for %s.", regAddr)
				return
			}
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("Shutdown signal received, de-registering service...")
		cancel()
		if err := db.RemoveServiceInstance(regAddr); err != nil {
			log.Printf("Failed to de-register service instance %s: %v", regAddr, err)
		} else {
			log.Printf("Service instance %s de-registered.", regAddr)
		}
		os.Exit(0)
	}()

	b := broker.New(db, regAddr, *useHTTPS)

	// --- Conditionally Start SSH Server ---
	if *sshListenAddr != "" {
		privateKeyPath := "ssh_host_key"
		if _, err := os.Stat(privateKeyPath); os.IsNotExist(err) {
			log.Println("Generating new SSH private key...")
			privateKey, err := generatePrivateKey()
			if err != nil {
				log.Fatalf("Failed to generate SSH private key: %v", err)
			}
			err = os.WriteFile(privateKeyPath, []byte(privateKey), 0600)
			if err != nil {
				log.Fatalf("Failed to write SSH private key: %v", err)
			}
		}

		privateKey, err := os.ReadFile(privateKeyPath)
		if err != nil {
			log.Fatalf("Failed to read SSH private key: %v", err)
		}

		sshServer, err := ssh.NewSSHServer(b.GetBus(), db, string(privateKey))
		if err != nil {
			log.Fatalf("Failed to create SSH server: %v", err)
		}
		sshServer.Start(*sshListenAddr)
	} else {
		log.Println("SSH server is not configured to start. Use the -ssh-listen flag to enable it.")
	}

	router := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept"}
	router.Use(cors.New(config))

	api := router.Group("/api")
	{
		// HTTP Mock routes
		api.POST("/config", b.HandleSetConfig)
		api.GET("/configs", b.HandleGetConfigs)
		api.GET("/configs/sources", b.HandleGetConfigSources)
		api.GET("/config/*endpoint", b.HandleGetConfig)
		api.DELETE("/config/*endpoint", b.HandleDeleteConfig)
		api.POST("/rules", b.HandleAddRule)
		api.PUT("/rules/:ruleID", b.HandleUpdateRule)
		api.DELETE("/rules/:ruleID", b.HandleDeleteRule)

		// SSH Mock routes
		api.POST("/ssh/config", b.HandleSetSshConfig)
		api.GET("/ssh/configs", b.HandleGetSshConfigs)
		api.GET("/ssh/config/:command", b.HandleGetSshConfig)
		api.DELETE("/ssh/config/:command", b.HandleDeleteSshConfig)
		api.GET("/ssh/history", b.HandleGetSshHistory)

		// Common routes
		api.GET("/events", b.HandleSSEConnection)
		api.POST("/events/forward", b.HandleForwardedEvent)
		api.GET("/services", b.HandleGetServices)
		api.POST("/respond", b.HandleRespond)
		api.GET("/history", b.HandleGetHistory)
		api.GET("/history/sources", b.HandleGetHistorySources)
	}

	router.GET("/app.config.js", func(c *gin.Context) {
		jsContent := fmt.Sprintf(`window.APP_CONFIG = { apiBaseUrl: "%s://%s" };`, protocol, regAddr)
		c.Data(http.StatusOK, "application/javascript", []byte(jsContent))
	})

	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method != "POST" && c.Request.Method != "PUT" && c.Request.Method != "PATCH" &&
			!strings.HasPrefix(c.Request.URL.Path, "/api/") {

			fsys, err := fs.Sub(embeddedFiles, "zyuc-mock-clean-web/out")
			if err != nil {
				log.Printf("Failed to get sub filesystem: %v", err)
				c.String(http.StatusInternalServerError, "Internal Server Error")
				return
			}
			http.FileServer(http.FS(fsys)).ServeHTTP(c.Writer, c.Request)
			return
		}
		b.HandlePublish(c)
	})

	if *useHTTPS {
		log.Printf("Gin server starting with HTTPS, listening on %s", *listenAddr)
		if err := router.RunTLS(*listenAddr, *certFile, *keyFile); err != nil {
			log.Fatalf("Gin server (HTTPS) failed to start: %v", err)
		}
	} else {
		log.Printf("Gin server starting with HTTP, listening on %s", *listenAddr)
		if err := router.Run(*listenAddr); err != nil {
			log.Fatalf("Gin server (HTTP) failed to start: %v", err)
		}
	}
}
