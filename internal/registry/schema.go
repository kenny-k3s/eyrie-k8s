package registry

import (
	"encoding/json"
	"strings"
	"time"
)

// Registry represents the complete Claw frameworks registry
type Registry struct {
	Version    string      `json:"version"`
	UpdatedAt  time.Time   `json:"updated_at"`
	Frameworks []Framework `json:"frameworks"`
}

// Framework describes a single Claw agent framework
type Framework struct {
	// Identity
	ID          string `json:"id"`                // "hermes", "zeroclaw", "openclaw"
	Name        string `json:"name"`              // Display name
	Description string `json:"description"`       // Short description
	Language    string `json:"language"`          // "python", "rust", "typescript"
	Repository  string `json:"repository"`        // GitHub URL
	Website     string `json:"website,omitempty"` // Official website URL (optional)

	// Installation
	InstallMethod string   `json:"install_method"` // "script", "cargo", "npm", "pip", "manual"
	InstallCmd    string   `json:"install_cmd"`    // Command or script URL
	Requirements  []string `json:"requirements"`   // ["python>=3.11", "node>=22"]

	// Version constraints (optional — empty means "no constraint" / "unknown")
	MinVersion    string `json:"min_version,omitempty"`    // Minimum compatible version (e.g. "0.7.0")
	LatestVersion string `json:"latest_version,omitempty"` // Latest known release version

	// Configuration
	ConfigFormat string        `json:"config_format"`           // "toml", "json", "yaml"
	ConfigPath   string        `json:"config_path"`             // "~/.hermes/config.yaml"
	ConfigDir    string        `json:"config_dir"`              // "~/.hermes"
	ConfigSchema *ConfigSchema `json:"config_schema,omitempty"` // Optional config form schema

	// Runtime
	BinaryPath  string `json:"binary_path"`            // "~/.local/bin/hermes"
	AdapterType string `json:"adapter_type"`           // "http", "websocket", "cli", "hybrid", "app-server"
	DefaultPort int    `json:"default_port,omitempty"` // 0 if not applicable

	// Lifecycle commands
	StartCmd   string `json:"start_cmd"`   // "hermes gateway start"
	StopCmd    string `json:"stop_cmd"`    // "" (means PID-based)
	StatusCmd  string `json:"status_cmd"`  // "hermes status" or ""
	RestartCmd string `json:"restart_cmd"` // Optional explicit restart command

	// Status detection (for adapters without HTTP APIs)
	PIDFile   string `json:"pid_file,omitempty"`   // "~/.hermes/gateway.pid"
	StateFile string `json:"state_file,omitempty"` // "~/.hermes/gateway_state.json"
	HealthURL string `json:"health_url,omitempty"` // "http://localhost:42617/health"

	// Logs and activity
	LogDir    string `json:"log_dir"`    // "~/.hermes/logs"
	LogFormat string `json:"log_format"` // "text", "json"
}

func IsSupportedAdapterType(adapterType string) bool {
	switch adapterType {
	case "http", "websocket", "cli", "hybrid", "app-server":
		return true
	default:
		return false
	}
}

func (fw Framework) DefaultConfigValues() (map[string]any, bool) {
	if fw.ConfigSchema == nil || len(fw.ConfigSchema.CommonFields) == 0 {
		return nil, false
	}

	values := map[string]any{}
	for _, field := range fw.ConfigSchema.CommonFields {
		if field.Key == "" || field.Default == nil {
			continue
		}
		setDefaultConfigValue(values, field.Key, field.Default)
	}
	return values, len(values) > 0
}

func (fw Framework) DefaultConfigDocument() ([]byte, bool, error) {
	if strings.ToLower(fw.ConfigFormat) != "json" {
		return nil, false, nil
	}
	values, ok := fw.DefaultConfigValues()
	if !ok {
		return nil, false, nil
	}
	data, err := json.MarshalIndent(values, "", "  ")
	if err != nil {
		return nil, false, err
	}
	return data, true, nil
}

func setDefaultConfigValue(values map[string]any, key string, value any) {
	parts := strings.Split(key, ".")
	current := values
	for _, part := range parts[:len(parts)-1] {
		next, _ := current[part].(map[string]any)
		if next == nil {
			next = map[string]any{}
			current[part] = next
		}
		current = next
	}
	current[parts[len(parts)-1]] = value
}

// DefaultInstallCmd returns the default package-manager command for this
// framework (e.g. "cargo install zeroclaw"). Returns "" for non-package-manager
// install methods (script, manual).
func (fw Framework) DefaultInstallCmd() string {
	switch fw.InstallMethod {
	case "cargo":
		return "cargo install " + fw.ID
	case "npm":
		return "npm install -g " + fw.ID
	case "pip":
		return "pip install " + fw.ID
	default:
		return ""
	}
}

// IsCustomInstallCmd reports whether the registry specifies a non-default
// install command for this framework (e.g. --git, @version, custom flags).
func (fw Framework) IsCustomInstallCmd() bool {
	dflt := fw.DefaultInstallCmd()
	return dflt != "" && fw.InstallCmd != "" && fw.InstallCmd != dflt
}

// ConfigSchema defines editable configuration fields for a framework
type ConfigSchema struct {
	CommonFields []ConfigField `json:"common_fields"` // Editable fields for the config form
	APIKeyHint   string        `json:"api_key_hint"`  // Instructions for setting API keys
}

// ConfigField represents a single editable configuration field
type ConfigField struct {
	Key            string          `json:"key"`                       // Config key (dot notation for nested: "gateway.port")
	Label          string          `json:"label"`                     // Display label
	Type           string          `json:"type"`                      // "text", "number", "select", "checkbox", "multiselect"
	Default        any             `json:"default,omitempty"`         // Default value
	Required       bool            `json:"required"`                  // Whether field is required
	Description    string          `json:"description"`               // Help text
	Options        []string        `json:"options,omitempty"`         // For select/multiselect types
	Suggestions    json.RawMessage `json:"suggestions,omitempty"`     // string[] or map[string]string[] for provider-keyed models
	SuggestionsKey string          `json:"suggestions_key,omitempty"` // field key to select from suggestions map
	Min            *int            `json:"min,omitempty"`             // For number types
	Max            *int            `json:"max,omitempty"`             // For number types
	Advanced       bool            `json:"advanced,omitempty"`        // Hide behind "advanced" toggle in quick setup
	Group          string          `json:"group,omitempty"`           // Layout group: same-group fields render side-by-side
}
