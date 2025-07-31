package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"mock.com/zyuc-mock-clean/service/broker"
	"mock.com/zyuc-mock-clean/storage"
)

func main() {
    // ... (db setup) ...
    db, err := storage.NewDB("mock_config.db")
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	b := broker.New(db)
	router := gin.Default()

    // Use the professional CORS middleware
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000"}, // Critical: Allow your Next.js origin
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

    // ... (rest of the main function) ...
    router.Static("/web", "./web/static")

    api := router.Group("/api")
    {
        api.GET("/events", b.HandleSSEConnection)
        api.POST("/respond", b.HandleRespond)
        api.POST("/config", b.HandleSetConfig)
        api.GET("/configs", b.HandleGetConfigs)
        api.GET("/config/*endpoint", b.HandleGetConfig)
        api.DELETE("/config/*endpoint", b.HandleDeleteConfig)
        api.GET("/history", b.HandleGetHistory)
    }

    router.NoRoute(func(c *gin.Context) {
        if c.Request.Method == "POST" || c.Request.Method == "PUT" || c.Request.Method == "PATCH" {
            b.HandlePublish(c)
        } else {
            c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Endpoint not found"})
        }
    })

    log.Println("Gin server starting on http://localhost:8080")
    if err := router.Run(":8080"); err != nil {
        log.Fatalf("Gin server failed to start: %v", err)
    }
}