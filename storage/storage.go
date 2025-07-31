package storage

import (
	"log"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Config struct {
	gorm.Model
	Endpoint        string `gorm:"uniqueIndex"`
	Project         string `gorm:"index"`
	Remark          string
	DefaultResponse string
}

type Event struct {
	gorm.Model
	RequestID    string `gorm:"uniqueIndex"`
	Endpoint     string `gorm:"index"`
	Project      string `gorm:"index"`
	Payload      string
	ResponseBody string
	Status       string
	Timestamp    time.Time
}

type DB struct {
	*gorm.DB
}

func NewDB(dsn string) (*DB, error) {
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	err = db.AutoMigrate(&Config{}, &Event{})
	if err != nil {
		return nil, err
	}
	log.Println("Database connection successful and schema migrated.")
	return &DB{db}, nil
}

func (db *DB) GetConfig(endpoint string) (*Config, error) {
	var config Config
	result := db.Where("endpoint = ?", endpoint).First(&config)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, result.Error
	}
	return &config, nil
}

func (db *DB) SetConfig(endpoint, project, remark, response string) error {
	config := Config{
		Endpoint:        endpoint,
		Project:         project,
		Remark:          remark,
		DefaultResponse: response,
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "endpoint"}},
		DoUpdates: clause.AssignmentColumns([]string{"project", "remark", "default_response"}),
	}).Create(&config).Error
}

func (db *DB) GetAllConfigs() ([]Config, error) {
	var configs []Config
	result := db.Order("project, endpoint").Find(&configs)
	return configs, result.Error
}

func (db *DB) DeleteConfig(endpoint string) error {
	return db.Where("endpoint = ?", endpoint).Delete(&Config{}).Error
}

// CreateEvent creates a new event record in the database.
func (db *DB) CreateEvent(requestID, endpoint, project, payload, responseBody, status string) error {
	event := Event{
		RequestID:    requestID,
		Endpoint:     endpoint,
		Project:      project,
		Payload:      payload,
		ResponseBody: responseBody,
		Status:       status,
		Timestamp:    time.Now(),
	}
	return db.Create(&event).Error
}

// UpdateEventResponse updates the response body and status for an existing event.
func (db *DB) UpdateEventResponse(requestID, responseBody, status string) error {
	return db.Model(&Event{}).Where("request_id = ?", requestID).Updates(map[string]interface{}{
		"response_body": responseBody,
		"status":        status,
	}).Error
}

// GetEvents retrieves a paginated list of historical events.
func (db *DB) GetEvents(page, pageSize int, project, search string) ([]Event, int64, error) {
	var events []Event
	var total int64

	query := db.Model(&Event{})
	if project != "" {
		query = query.Where("project = ?", project)
	}
	if search != "" {
		searchPattern := "%" + search + "%"
		query = query.Where("endpoint LIKE ? OR payload LIKE ? OR response_body LIKE ?", searchPattern, searchPattern, searchPattern)
	}

	// First, count the total records matching the filter
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	// Then, apply pagination and retrieve the data
	offset := (page - 1) * pageSize
	err = query.Order("timestamp desc").Offset(offset).Limit(pageSize).Find(&events).Error
	if err != nil {
		return nil, 0, err
	}

	return events, total, nil
}

// GetEventStatus retrieves the current status of an event.
func (db *DB) GetEventStatus(requestID string) (string, error) {
	var event Event
	result := db.Model(&Event{}).Select("status").Where("request_id = ?", requestID).First(&event)
	if result.Error != nil {
		return "", result.Error
	}
	return event.Status, nil
}
