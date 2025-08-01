package main

import (
	"context"
	"embed"
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

func main() {
	listenAddr := flag.String("listen", ":8080", "Listen address (e.g., :8080)")
	useHTTPS := flag.Bool("https", false, "Enable HTTPS")
	certFile := flag.String("certfile", "cert.pem", "Path to SSL/TLS certificate file")
	keyFile := flag.String("keyfile", "key.pem", "Path to SSL/TLS key file")
	flag.Parse()

	// 1. protocol 变量现在至关重要
	protocol := "http"
	if *useHTTPS {
		protocol = "https"
	}

	// ... (IP 和端口解析逻辑保持不变)
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
	
    // 2. 注册服务时传入 protocol
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
                // 3. 心跳时也传入 protocol
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

	// Broker 的 New 函数现在不再需要 protocol，因为它会在需要时从DB查询
	b := broker.New(db, regAddr, *useHTTPS)
	router := gin.Default()
	
	// ... (CORS 和 API 路由设置保持不变)
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept"}
	router.Use(cors.New(config))

	api := router.Group("/api")
	{
		api.GET("/events", b.HandleSSEConnection)
		api.POST("/events/forward", b.HandleForwardedEvent)
		api.GET("/services", b.HandleGetServices)
		api.POST("/respond", b.HandleRespond)
		api.POST("/config", b.HandleSetConfig)
		api.GET("/configs", b.HandleGetConfigs)
		api.GET("/configs/sources", b.HandleGetConfigSources)
		api.GET("/config/*endpoint", b.HandleGetConfig)
		api.DELETE("/config/*endpoint", b.HandleDeleteConfig)
		api.POST("/rules", b.HandleAddRule)
		api.DELETE("/rules/:ruleID", b.HandleDeleteRule)
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