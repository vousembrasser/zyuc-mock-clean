package storage

import (
	"log"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ServiceInstance struct {
	Address    string `gorm:"primaryKey"`
	LastSeenAt time.Time
}

type Config struct {
	gorm.Model
	Endpoint        string `gorm:"uniqueIndex"`
	Project         string `gorm:"index"`
	Remark          string
	DefaultResponse string
	Source          string `gorm:"index"`
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
	Source       string `gorm:"index"`
}

type DB struct {
	*gorm.DB
}

func NewDB(dsn string) (*DB, error) {
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	err = db.AutoMigrate(&Config{}, &Event{}, &ServiceInstance{})
	if err != nil {
		return nil, err
	}
	log.Println("Database connection successful and schema migrated.")
	return &DB{db}, nil
}

// GetConfigForRequest finds the best matching config for a given request.
// Priority:
// 1. Exact match on both Endpoint and Source.
// 2. Match on Endpoint only, where Source is empty or NULL.
func (db *DB) GetConfigForRequest(endpoint, source string) (*Config, error) {
	var config Config

	// 1. Try to find an exact match for endpoint and source
	err := db.Where("endpoint = ? AND source = ?", endpoint, source).First(&config).Error
	if err == nil {
		return &config, nil // Found exact match
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err // A real database error occurred
	}

	// 2. If not found, try to find a match for the endpoint with an empty/null source
	err = db.Where("endpoint = ? AND (source IS NULL OR source = ?)", endpoint, "").First(&config).Error
	if err == nil {
		return &config, nil // Found endpoint-only match
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err // A real database error occurred
	}

	// 3. No suitable config found
	return nil, nil
}

// GetConfigByEndpoint retrieves a config by its endpoint only (for editing purposes).
func (db *DB) GetConfigByEndpoint(endpoint string) (*Config, error) {
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

func (db *DB) UpsertServiceInstance(address string) error {
	instance := ServiceInstance{
		Address:    address,
		LastSeenAt: time.Now(),
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "address"}},
		DoUpdates: clause.AssignmentColumns([]string{"last_seen_at"}),
	}).Create(&instance).Error
}

func (db *DB) GetActiveServiceInstances(timeout time.Duration) ([]string, error) {
	var instances []ServiceInstance
	var addresses []string
	cutoffTime := time.Now().Add(-timeout)
	result := db.Where("last_seen_at > ?", cutoffTime).Find(&instances)
	if result.Error != nil {
		return nil, result.Error
	}
	for _, instance := range instances {
		addresses = append(addresses, instance.Address)
	}
	return addresses, nil
}

func (db *DB) RemoveServiceInstance(address string) error {
	return db.Where("address = ?", address).Delete(&ServiceInstance{}).Error
}

func (db *DB) SetConfig(endpoint, project, remark, response, source string) error {
	config := Config{
		Endpoint:        endpoint,
		Project:         project,
		Remark:          remark,
		DefaultResponse: response,
		Source:          source,
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "endpoint"}},
		DoUpdates: clause.AssignmentColumns([]string{"project", "remark", "default_response", "source"}),
	}).Create(&config).Error
}

func (db *DB) GetAllConfigSources() ([]string, error) {
	var sources []string
	err := db.Model(&Config{}).
		Where("source IS NOT NULL AND source != ?", "").
		Distinct().
		Order("source asc").
		Pluck("source", &sources).Error
	if err != nil {
		return nil, err
	}
	return sources, nil
}

func (db *DB) GetAllConfigs() ([]Config, error) {
	var configs []Config
	result := db.Order("project, source, endpoint").Find(&configs)
	return configs, result.Error
}

func (db *DB) DeleteConfig(endpoint string) error {
	return db.Where("endpoint = ?", endpoint).Delete(&Config{}).Error
}

func (db *DB) CreateEvent(requestID, endpoint, project, payload, responseBody, status, source string) error {
	event := Event{
		RequestID:    requestID,
		Endpoint:     endpoint,
		Project:      project,
		Payload:      payload,
		ResponseBody: responseBody,
		Status:       status,
		Timestamp:    time.Now(),
		Source:       source,
	}
	return db.Create(&event).Error
}

func (db *DB) UpdateEventResponse(requestID, responseBody, status string) error {
	return db.Model(&Event{}).Where("request_id = ?", requestID).Updates(map[string]interface{}{
		"response_body": responseBody,
		"status":        status,
	}).Error
}

func (db *DB) GetEvents(page, pageSize int, project, search, source string) ([]Event, int64, error) {
	var events []Event
	var total int64
	query := db.Model(&Event{})
	if project != "" {
		query = query.Where("project = ?", project)
	}
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if search != "" {
		searchPattern := "%" + search + "%"
		query = query.Where("endpoint LIKE ? OR payload LIKE ? OR response_body LIKE ?", searchPattern, searchPattern, searchPattern)
	}
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	offset := (page - 1) * pageSize
	err = query.Order("timestamp desc").Offset(offset).Limit(pageSize).Find(&events).Error
	if err != nil {
		return nil, 0, err
	}
	return events, total, nil
}

func (db *DB) GetEventStatus(requestID string) (string, error) {
	var event Event
	result := db.Model(&Event{}).Select("status").Where("request_id = ?", requestID).First(&event)
	if result.Error != nil {
		return "", result.Error
	}
	return event.Status, nil
}

func (db *DB) GetAllEventSources() ([]string, error) {
	var sources []string
	err := db.Model(&Event{}).
		Where("source IS NOT NULL AND source != ?", "").
		Distinct().
		Order("source asc").
		Pluck("source", &sources).Error
	if err != nil {
		return nil, err
	}
	return sources, nil
}