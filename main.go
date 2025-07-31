package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"mock.com/zyuc-mock-clean/service/broker"
	"mock.com/zyuc-mock-clean/storage"
)

func main() {
	db, err := storage.NewDB("mock_config.db")
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	b := broker.New(db)
	router := gin.Default()
	router.Static("/web", "./web/static")

	api := router.Group("/api")
	{
		api.GET("/events", b.HandleSSEConnection)
		api.POST("/respond", b.HandleRespond) // This route is needed again for interactive mode
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

	 router.Use(func(c *gin.Context) {
        c.Writer.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
        c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
        c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
        
        if c.Request.Method == "OPTIONS" {
            c.AbortWithStatus(204)
            return
        }
        
        c.Next()
    })

	log.Println("Gin server starting on http://localhost:8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Gin server failed to start: %v", err)
	}
}
