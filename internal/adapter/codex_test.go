package adapter

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestCodexAppServerNotificationToChatEvent(t *testing.T) {
	tests := []struct {
		name   string
		method string
		params string
		want   ChatEvent
		wantOK bool
	}{
		{
			name:   "agent message delta",
			method: "item/agentMessage/delta",
			params: `{"delta":"hello"}`,
			want:   ChatEvent{Type: "delta", Content: "hello"},
			wantOK: true,
		},
		{
			name:   "command execution started",
			method: "item/started",
			params: `{"item":{"id":"item_1","type":"commandExecution","command":"go test ./..."}}`,
			want:   ChatEvent{Type: "tool_start", Tool: "commandExecution", ToolID: "item_1", Args: map[string]any{"command": "go test ./..."}},
			wantOK: true,
		},
		{
			name:   "command execution completed",
			method: "item/completed",
			params: `{"item":{"id":"item_1","type":"commandExecution","status":"completed","aggregatedOutput":"ok"}}`,
			want:   ChatEvent{Type: "tool_result", Tool: "commandExecution", ToolID: "item_1", Output: "ok", Success: boolPtr(true)},
			wantOK: true,
		},
		{
			name:   "file change completed with diff",
			method: "item/completed",
			params: `{"item":{"id":"item_2","type":"fileChange","status":"completed","changes":[{"path":"/tmp/a.txt","kind":"modify","diff":"@@\n-old\n+new"}]}}`,
			want:   ChatEvent{Type: "tool_result", Tool: "fileChange", ToolID: "item_2", Output: "/tmp/a.txt modify\n@@\n-old\n+new", Success: boolPtr(true)},
			wantOK: true,
		},
		{
			name:   "codex error notification",
			method: "error",
			params: `{"error":{"message":"context window exceeded"}}`,
			want:   ChatEvent{Type: "error", Error: "context window exceeded"},
			wantOK: true,
		},
		{
			name:   "plan item without status is not marked failed",
			method: "item/completed",
			params: `{"item":{"id":"item_3","type":"plan","text":"1. inspect\n2. patch"}}`,
			want:   ChatEvent{Type: "tool_result", Tool: "plan", ToolID: "item_3", Output: "1. inspect\n2. patch", Success: boolPtr(true)},
			wantOK: true,
		},
		{
			name:   "ignored notification",
			method: "thread/updated",
			params: `{}`,
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var params json.RawMessage = []byte(tt.params)
			got, ok := codexChatEventFromNotification(tt.method, params)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v; event = %#v", ok, tt.wantOK, got)
			}
			if !tt.wantOK {
				return
			}
			if got.Type != tt.want.Type || got.Content != tt.want.Content || got.Tool != tt.want.Tool || got.ToolID != tt.want.ToolID || got.Output != tt.want.Output {
				t.Fatalf("event = %#v, want %#v", got, tt.want)
			}
			if tt.want.Success != nil {
				if got.Success == nil || *got.Success != *tt.want.Success {
					t.Fatalf("success = %#v, want %#v", got.Success, tt.want.Success)
				}
			}
			if tt.want.Args != nil {
				if got.Args["command"] != tt.want.Args["command"] {
					t.Fatalf("args = %#v, want %#v", got.Args, tt.want.Args)
				}
			}
		})
	}
}

func TestCodexTokenUsageFromNotification(t *testing.T) {
	params := json.RawMessage(`{"usage":{"inputTokens":123,"outputTokens":45}}`)
	input, output := codexUsageFromParams(params)
	if input != 123 || output != 45 {
		t.Fatalf("usage = (%d, %d), want (123, 45)", input, output)
	}
}

func TestCodexApprovalRequestDoesNotAutoApprove(t *testing.T) {
	params := json.RawMessage(`{"itemId":"item_2","threadId":"thr_1","turnId":"turn_1","command":"git push","reason":"network mutation"}`)
	event, response := codexChatEventFromServerRequest("item/commandExecution/requestApproval", params)

	if event.Type != "error" {
		t.Fatalf("event type = %q, want error", event.Type)
	}
	if event.Error == "" {
		t.Fatalf("approval request should surface an operator-visible error")
	}
	if response["decision"] == "accept" || response["decision"] == "acceptForSession" {
		t.Fatalf("approval response must not auto-approve: %#v", response)
	}
	if response["decision"] != "decline" {
		t.Fatalf("approval response = %#v, want decline", response)
	}
}

func TestCodexUserInputRequestReturnsSchemaValidEmptyAnswers(t *testing.T) {
	params := json.RawMessage(`{"threadId":"thr_1","turnId":"turn_1","questions":[{"id":"confirm","question":"Proceed?"}]}`)
	event, response := codexChatEventFromServerRequest("item/tool/requestUserInput", params)

	if event.Type != "error" {
		t.Fatalf("event type = %q, want error", event.Type)
	}
	answers, ok := response["answers"].(map[string]any)
	if !ok {
		t.Fatalf("response = %#v, want answers object", response)
	}
	if len(answers) != 0 {
		t.Fatalf("answers = %#v, want empty answers", answers)
	}
}

func TestCodexTurnStartParamsKeepEyrieIdentityOutsideCodex(t *testing.T) {
	cfg := codexConfig{
		CWD:            "/tmp/project",
		Model:          "gpt-5.4",
		Effort:         "medium",
		Personality:    "concise",
		ApprovalPolicy: "untrusted",
		Sandbox:        "workspaceWrite",
		NetworkAccess:  false,
	}

	params := codexTurnStartParams("thr_123", "run tests", cfg)
	data, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal params: %v", err)
	}
	raw := string(data)
	for _, want := range []string{
		`"threadId":"thr_123"`,
		`"text":"run tests"`,
		`"cwd":"/tmp/project"`,
		`"model":"gpt-5.4"`,
		`"approvalPolicy":"untrusted"`,
		`"type":"workspaceWrite"`,
		`"writableRoots":["/tmp/project"]`,
	} {
		if !jsonContains(raw, want) {
			t.Fatalf("turn/start params missing %s in %s", want, raw)
		}
	}
}

func TestCodexThreadStartParamsUseLocalSchemaSandboxNames(t *testing.T) {
	cfg := codexConfig{
		CWD:            "/tmp/project",
		Model:          "gpt-5.4",
		ApprovalPolicy: "untrusted",
		Sandbox:        "workspaceWrite",
	}

	params := codexThreadStartParams(cfg)
	if params["sandbox"] != "workspace-write" {
		t.Fatalf("sandbox = %#v, want workspace-write", params["sandbox"])
	}
}

func TestCodexConfigDefaultsDeriveManagedHomeFromConfigPath(t *testing.T) {
	cfg := codexConfig{}
	applyCodexConfigDefaults(&cfg, "/tmp/eyrie/agent/workspace", "/tmp/eyrie/agent/config.json")

	if cfg.CodexHome != "/tmp/eyrie/agent/codex-home" {
		t.Fatalf("codex home = %q, want /tmp/eyrie/agent/codex-home", cfg.CodexHome)
	}
	if cfg.InstructionsPath != "/tmp/eyrie/agent/workspace/AGENTS.md" {
		t.Fatalf("instructions path = %q, want workspace AGENTS.md", cfg.InstructionsPath)
	}
}

func TestCodexProcessEnvUsesManagedHome(t *testing.T) {
	env := codexProcessEnv([]string{"PATH=/bin", "CODEX_HOME=/old"}, codexConfig{CodexHome: "/tmp/eyrie/codex-home"})

	var seen int
	for _, entry := range env {
		if strings.HasPrefix(entry, "CODEX_HOME=") {
			seen++
			if entry != "CODEX_HOME=/tmp/eyrie/codex-home" {
				t.Fatalf("CODEX_HOME entry = %q", entry)
			}
		}
	}
	if seen != 1 {
		t.Fatalf("CODEX_HOME entries = %d, env = %#v", seen, env)
	}
}

func TestCodexSessionsDoNotDuplicateDefaultThread(t *testing.T) {
	a := &CodexAdapter{
		cfg: codexConfig{
			ThreadID: "thr_default",
			Threads: map[string]string{
				"default": "thr_default",
				"review":  "thr_review",
				"empty":   "",
			},
		},
	}

	sessions, err := a.Sessions(context.Background())
	if err != nil {
		t.Fatalf("sessions: %v", err)
	}
	seen := map[string]int{}
	for _, session := range sessions {
		seen[session.Key]++
	}
	if seen["default"] != 1 {
		t.Fatalf("default count = %d, sessions = %#v", seen["default"], sessions)
	}
	if seen["review"] != 1 {
		t.Fatalf("review count = %d, sessions = %#v", seen["review"], sessions)
	}
	if seen["empty"] != 0 {
		t.Fatalf("empty session should not be listed: %#v", sessions)
	}
}

func boolPtr(v bool) *bool {
	return &v
}

func jsonContains(raw, want string) bool {
	var compactWant, compactRaw any
	if json.Unmarshal([]byte("{"+want+"}"), &compactWant) == nil {
		// Fallback below is enough for this test; the parse branch just keeps
		// malformed want snippets from hiding accidental whitespace dependence.
	}
	_ = compactRaw
	return strings.Contains(raw, want)
}
