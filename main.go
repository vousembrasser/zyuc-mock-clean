package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	// "github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"mock.com/zyuc-mock-clean/service/broker"
	"mock.com/zyuc-mock-clean/storage"
)

func main() {
	listenAddr := flag.String("listen", ":8080", "Listen address for the server (e.g., :8080 or 127.0.0.1:8081)")
	flag.Parse()

    regAddr := *listenAddr
    if strings.HasPrefix(regAddr, ":") {
        regAddr = "127.0.0.1" + regAddr
    } else if _, _, err := net.SplitHostPort(regAddr); err != nil {
        if net.ParseIP(regAddr) != nil {
             regAddr = net.JoinHostPort(regAddr, "8080")
        }
    }

	db, err := storage.NewDB("mock_config.db")
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := db.UpsertServiceInstance(regAddr); err != nil {
		log.Fatalf("Failed to register service instance: %v", err)
	}
	log.Printf("Service instance %s registered.", regAddr)

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := db.UpsertServiceInstance(regAddr); err != nil {
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

	b := broker.New(db, regAddr)
	router := gin.Default()

	// router.Use(cors.New(cors.Config{
	// 	AllowOrigins:     []string{"http://localhost:3000"},
	// 	AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	// 	AllowHeaders:     []string{"Origin", "Content-Type"},
	// 	AllowCredentials: true,
	// 	MaxAge:           12 * time.Hour,
	// }))

	// router.Static("/web", "./web/static")

	api := router.Group("/api")
	{
		api.GET("/events", b.HandleSSEConnection)
		api.GET("/services", b.HandleGetServices)
		api.POST("/respond", b.HandleRespond)
		api.POST("/config", b.HandleSetConfig)
		api.GET("/configs", b.HandleGetConfigs)
		api.GET("/configs/sources", b.HandleGetConfigSources)
		api.GET("/config/*endpoint", b.HandleGetConfig)
		api.DELETE("/config/*endpoint", b.HandleDeleteConfig)
		
		// THE FIX: Rule routes are now completely separate.
		api.POST("/rules", b.HandleAddRule)
		api.DELETE("/rules/:ruleID", b.HandleDeleteRule)
		
		api.GET("/history", b.HandleGetHistory)
		api.GET("/history/sources", b.HandleGetHistorySources)
	}

	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method == "POST" || c.Request.Method == "PUT" || c.Request.Method == "PATCH" {
			b.HandlePublish(c)
		} else {
			c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Endpoint not found"})
		}
	})

	log.Printf("Gin server starting, listening on %s", *listenAddr)
	if err := router.Run(*listenAddr); err != nil {
		log.Fatalf("Gin server failed to start: %v", err)
	}
}