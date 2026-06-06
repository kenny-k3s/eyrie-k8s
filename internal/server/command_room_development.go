package server

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const commandRoomDevelopmentScope = "zeroclaw-labs/zeroclaw#6398"

type commandRoomDevelopment struct {
	Root            string                           `json:"root"`
	Scope           string                           `json:"scope"`
	Status          string                           `json:"status"`
	Provenance      string                           `json:"provenance"`
	Assignments     []commandRoomDevelopmentNotice   `json:"assignments"`
	WorkItems       []commandRoomDevelopmentWorkItem `json:"work_items"`
	RuntimeSmokes   []commandRoomRuntimeSmoke        `json:"runtime_smokes"`
	ProjectControls []commandRoomProjectControl      `json:"project_controls"`
}

type commandRoomDevelopmentNotice struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Status           string   `json:"status"`
	Priority         string   `json:"priority"`
	From             string   `json:"from"`
	Owner            string   `json:"owner"`
	Worker           string   `json:"worker"`
	Summary          string   `json:"summary"`
	Request          string   `json:"request"`
	ResponsePath     string   `json:"response_path,omitempty"`
	ApprovalBoundary string   `json:"approval_boundary,omitempty"`
	ContextRefs      []string `json:"context_refs,omitempty"`
	SourcePath       string   `json:"source_path"`
	Provenance       string   `json:"provenance"`
}

type commandRoomDevelopmentWorkItem struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind,omitempty"`
	Title           string   `json:"title"`
	Status          string   `json:"status"`
	Priority        string   `json:"priority"`
	Lane            string   `json:"lane,omitempty"`
	Owner           string   `json:"owner"`
	Summary         string   `json:"summary"`
	NextAction      string   `json:"next_action"`
	ParentProjectID string   `json:"parent_project_id,omitempty"`
	SourceRefs      []string `json:"source_refs,omitempty"`
	Updated         string   `json:"updated,omitempty"`
	SourcePath      string   `json:"source_path"`
	Provenance      string   `json:"provenance"`
	responseRefs    []string
	labels          []string
}

type commandRoomProjectControl struct {
	ID              string                          `json:"id"`
	Kind            string                          `json:"kind,omitempty"`
	Title           string                          `json:"title"`
	Status          string                          `json:"status"`
	Priority        string                          `json:"priority"`
	Lane            string                          `json:"lane,omitempty"`
	Owner           string                          `json:"owner"`
	Summary         string                          `json:"summary"`
	NextAction      string                          `json:"next_action"`
	ParentProjectID string                          `json:"parent_project_id,omitempty"`
	ParentProject   *commandRoomDevelopmentWorkItem `json:"parent_project,omitempty"`
	SourceRefs      []string                        `json:"source_refs,omitempty"`
	Notices         []commandRoomDevelopmentNotice  `json:"notices"`
	ResponsePackets []commandRoomArtifactRef        `json:"response_packets"`
	Reports         []commandRoomArtifactRef        `json:"reports"`
	RouteBoundary   string                          `json:"route_boundary"`
	SourcePath      string                          `json:"source_path"`
	Provenance      string                          `json:"provenance"`
}

type commandRoomArtifactRef struct {
	Path       string `json:"path"`
	Title      string `json:"title,omitempty"`
	ModifiedAt string `json:"modified_at,omitempty"`
	Provenance string `json:"provenance"`
}

type commandRoomRuntimeSmoke struct {
	ID         string            `json:"id"`
	Title      string            `json:"title"`
	Status     string            `json:"status"`
	Summary    string            `json:"summary"`
	SourcePath string            `json:"source_path"`
	Facts      []commandRoomFact `json:"facts"`
	Findings   []string          `json:"findings,omitempty"`
	Provenance string            `json:"provenance"`
}

type commandRoomFact struct {
	Label      string `json:"label"`
	Value      string `json:"value"`
	Provenance string `json:"provenance"`
	SourcePath string `json:"source_path,omitempty"`
}

type commandRoomDevelopmentInboxFile struct {
	Notices []commandRoomDevelopmentNoticeRecord `yaml:"notices"`
}

type commandRoomDevelopmentNoticeRecord struct {
	ID               string                                `yaml:"id"`
	Title            string                                `yaml:"title"`
	Created          string                                `yaml:"created"`
	From             string                                `yaml:"from"`
	FromAddress      string                                `yaml:"from_address"`
	To               []string                              `yaml:"to"`
	Parent           string                                `yaml:"parent"`
	Status           string                                `yaml:"status"`
	Priority         string                                `yaml:"priority"`
	Summary          string                                `yaml:"summary"`
	Request          string                                `yaml:"request"`
	Deliverable      string                                `yaml:"deliverable"`
	Response         string                                `yaml:"response"`
	ApprovalBoundary string                                `yaml:"approval_boundary"`
	ContextRefs      []string                              `yaml:"context_refs"`
	Payload          commandRoomDevelopmentNoticePayload   `yaml:"payload"`
	Acknowledgements []commandRoomDevelopmentAcknowledment `yaml:"acknowledgements"`
}

type commandRoomDevelopmentNoticePayload struct {
	Repo            string `yaml:"repo"`
	PR              int    `yaml:"pr"`
	ActiveOwner     string `yaml:"active_owner"`
	DelegatedWorker string `yaml:"delegated_worker"`
}

type commandRoomDevelopmentAcknowledment struct {
	ResponseArtifacts []string `yaml:"response_artifacts"`
}

func locateCommandRoomDevelopmentMeshRoot() string {
	if override := strings.TrimSpace(os.Getenv("EYRIE_DEVELOPMENT_MESH_DIR")); override != "" {
		return filepath.Clean(override)
	}

	if wd, err := os.Getwd(); err == nil {
		for {
			if filepath.Base(wd) == "Development" {
				candidate := filepath.Join(wd, "Codex", "agent-mesh")
				if dirExists(candidate) {
					return candidate
				}
			}
			parent := filepath.Dir(wd)
			if parent == wd {
				break
			}
			wd = parent
		}
	}

	fallback := "/Users/natalie/Development/Codex/agent-mesh"
	if dirExists(fallback) {
		return fallback
	}
	return ""
}

func readCommandRoomDevelopmentMesh(root string) *commandRoomDevelopment {
	if strings.TrimSpace(root) == "" || !dirExists(root) {
		return nil
	}
	dev := &commandRoomDevelopment{
		Root:       filepath.Clean(root),
		Scope:      commandRoomDevelopmentScope,
		Status:     "available",
		Provenance: "durable mesh state",
	}
	dev.Assignments = readCommandRoomDevelopmentAssignments(root)
	dev.WorkItems = readCommandRoomDevelopmentWorkItems(root)
	dev.RuntimeSmokes = readCommandRoomRuntimeSmokes(root)
	dev.ProjectControls = readCommandRoomProjectControls(root)
	if len(dev.Assignments) == 0 && len(dev.WorkItems) == 0 && len(dev.RuntimeSmokes) == 0 && len(dev.ProjectControls) == 0 {
		dev.Status = "available-empty"
	}
	return dev
}

func readCommandRoomDevelopmentAssignments(root string) []commandRoomDevelopmentNotice {
	matches, err := filepath.Glob(filepath.Join(root, "inboxes", "*.yaml"))
	if err != nil {
		return nil
	}
	var assignments []commandRoomDevelopmentNotice
	for _, match := range matches {
		var file commandRoomDevelopmentInboxFile
		if err := readYAMLFile(match, &file); err != nil {
			continue
		}
		for _, notice := range file.Notices {
			if !commandRoomDevelopmentMatchesScope(commandRoomNoticeScopeText(notice)) {
				continue
			}
			assignments = append(assignments, notice.toCommandRoomDevelopmentNotice(match))
		}
	}
	sort.Slice(assignments, func(i, j int) bool {
		if left, right := commandRoomAssignmentStatusRank(assignments[i].Status), commandRoomAssignmentStatusRank(assignments[j].Status); left != right {
			return left < right
		}
		if assignments[i].Priority == assignments[j].Priority {
			return assignments[i].ID < assignments[j].ID
		}
		return assignments[i].Priority > assignments[j].Priority
	})
	return assignments
}

func commandRoomAssignmentStatusRank(status string) int {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "open", "pending", "must_handle", "answered", "completed", "complete", "done":
		return 0
	case "superseded", "stale", "cancelled", "canceled":
		return 2
	default:
		return 1
	}
}

func (n commandRoomDevelopmentNoticeRecord) toCommandRoomDevelopmentNotice(sourcePath string) commandRoomDevelopmentNotice {
	owner := firstNonEmpty(n.Payload.ActiveOwner, n.Parent, n.FromAddress, n.From)
	worker := firstNonEmpty(n.Payload.DelegatedWorker, firstString(n.To))
	return commandRoomDevelopmentNotice{
		ID:               n.ID,
		Title:            n.Title,
		Status:           n.Status,
		Priority:         n.Priority,
		From:             firstNonEmpty(n.FromAddress, n.From),
		Owner:            owner,
		Worker:           worker,
		Summary:          n.Summary,
		Request:          n.Request,
		ResponsePath:     firstNonEmpty(n.Response, n.firstResponseArtifact()),
		ApprovalBoundary: n.ApprovalBoundary,
		ContextRefs:      n.ContextRefs,
		SourcePath:       sourcePath,
		Provenance:       "durable mesh state",
	}
}

func (n commandRoomDevelopmentNoticeRecord) firstResponseArtifact() string {
	for _, ack := range n.Acknowledgements {
		if artifact := firstString(ack.ResponseArtifacts); artifact != "" {
			return artifact
		}
	}
	return ""
}

func commandRoomNoticeScopeText(notice commandRoomDevelopmentNoticeRecord) string {
	var parts []string
	parts = append(parts, notice.ID, notice.Title, notice.Summary, notice.Request, notice.Deliverable, notice.Response, notice.Payload.Repo)
	if notice.Payload.PR != 0 {
		parts = append(parts, fmt.Sprintf("%d", notice.Payload.PR))
	}
	parts = append(parts, notice.ContextRefs...)
	for _, ack := range notice.Acknowledgements {
		parts = append(parts, ack.ResponseArtifacts...)
	}
	return strings.Join(parts, "\n")
}

func readCommandRoomDevelopmentWorkItems(root string) []commandRoomDevelopmentWorkItem {
	matches, err := filepath.Glob(filepath.Join(root, "work-items", "*.yaml"))
	if err != nil {
		return nil
	}
	var items []commandRoomDevelopmentWorkItem
	for _, match := range matches {
		data, err := os.ReadFile(match)
		if err != nil || !commandRoomDevelopmentMatchesScope(string(data)) {
			continue
		}
		var raw map[string]any
		if err := readYAMLFile(match, &raw); err != nil {
			continue
		}
		kind := commandRoomAnyString(raw["kind"])
		if kind != "" && kind != "pr" && kind != "project" && !strings.Contains(strings.ToLower(match), "live-router") {
			continue
		}
		items = append(items, commandRoomWorkItemFromRaw(match, raw))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Priority == items[j].Priority {
			return items[i].ID < items[j].ID
		}
		return items[i].Priority > items[j].Priority
	})
	return items
}

func readCommandRoomProjectControls(root string) []commandRoomProjectControl {
	workItems := readAllCommandRoomDevelopmentWorkItems(root)
	if len(workItems) == 0 {
		return nil
	}
	byID := map[string]commandRoomDevelopmentWorkItem{}
	for _, item := range workItems {
		byID[item.ID] = item
	}
	notices := readAllCommandRoomDevelopmentNotices(root)
	var controls []commandRoomProjectControl
	for _, item := range workItems {
		if !commandRoomIsEyrieControlItem(item) || item.Kind == "project" {
			continue
		}
		control := commandRoomProjectControl{
			ID:              item.ID,
			Kind:            item.Kind,
			Title:           item.Title,
			Status:          item.Status,
			Priority:        item.Priority,
			Lane:            item.Lane,
			Owner:           item.Owner,
			Summary:         item.Summary,
			NextAction:      item.NextAction,
			ParentProjectID: item.ParentProjectID,
			SourceRefs:      item.SourceRefs,
			SourcePath:      item.SourcePath,
			Provenance:      "durable mesh state",
			RouteBoundary:   "Read-only surface: route proposals through Rowan/Development and Magnus/Eyrie; do not mutate mesh files, runtimes, GitHub, commits, pushes, or public state from this view.",
		}
		if parent, ok := byID[item.ParentProjectID]; ok {
			parentCopy := parent
			control.ParentProject = &parentCopy
			control.SourceRefs = uniqueNonEmpty(append(control.SourceRefs, parent.SourceRefs...))
			control.ResponsePackets = append(control.ResponsePackets, commandRoomArtifactsFromPaths(parent.responseRefs, "response packet")...)
		}
		terms := commandRoomControlTerms(item, control.ParentProject)
		for _, notice := range notices {
			if commandRoomTextMatchesAny(commandRoomNoticeSearchText(notice), terms) {
				control.Notices = append(control.Notices, notice)
				control.ResponsePackets = append(control.ResponsePackets, commandRoomArtifactsFromPaths([]string{notice.ResponsePath}, "response packet")...)
			}
		}
		control.ResponsePackets = append(control.ResponsePackets, commandRoomArtifactsFromPaths(item.responseRefs, "response packet")...)
		control.Reports = commandRoomReportArtifacts(control.SourceRefs)
		control.ResponsePackets = commandRoomUniqueArtifacts(control.ResponsePackets)
		control.Reports = commandRoomUniqueArtifacts(control.Reports)
		if control.Notices == nil {
			control.Notices = []commandRoomDevelopmentNotice{}
		}
		if control.ResponsePackets == nil {
			control.ResponsePackets = []commandRoomArtifactRef{}
		}
		if control.Reports == nil {
			control.Reports = []commandRoomArtifactRef{}
		}
		sort.Slice(control.Notices, func(i, j int) bool {
			if control.Notices[i].Priority == control.Notices[j].Priority {
				return control.Notices[i].ID < control.Notices[j].ID
			}
			return control.Notices[i].Priority > control.Notices[j].Priority
		})
		controls = append(controls, control)
	}
	sort.Slice(controls, func(i, j int) bool {
		if controls[i].Priority == controls[j].Priority {
			return controls[i].ID < controls[j].ID
		}
		return controls[i].Priority > controls[j].Priority
	})
	return controls
}

func readAllCommandRoomDevelopmentWorkItems(root string) []commandRoomDevelopmentWorkItem {
	matches, err := filepath.Glob(filepath.Join(root, "work-items", "*.yaml"))
	if err != nil {
		return nil
	}
	items := make([]commandRoomDevelopmentWorkItem, 0, len(matches))
	for _, match := range matches {
		var raw map[string]any
		if err := readYAMLFile(match, &raw); err != nil {
			continue
		}
		items = append(items, commandRoomWorkItemFromRaw(match, raw))
	}
	return items
}

func commandRoomWorkItemFromRaw(path string, raw map[string]any) commandRoomDevelopmentWorkItem {
	return commandRoomDevelopmentWorkItem{
		ID:              commandRoomAnyString(raw["id"]),
		Kind:            commandRoomAnyString(raw["kind"]),
		Title:           commandRoomAnyString(raw["title"]),
		Status:          commandRoomAnyString(raw["status"]),
		Priority:        commandRoomAnyString(raw["priority"]),
		Lane:            commandRoomAnyString(raw["lane"]),
		Owner:           firstNonEmpty(commandRoomAnyString(raw["current_owner"]), commandRoomNestedString(raw, "active_claim", "agent"), commandRoomAnyString(raw["owner"])),
		Summary:         commandRoomAnyString(raw["summary"]),
		NextAction:      commandRoomAnyString(raw["next_action"]),
		ParentProjectID: commandRoomAnyString(raw["parent_project"]),
		SourceRefs:      commandRoomStringSlice(raw["source_refs"]),
		Updated:         commandRoomAnyString(raw["updated"]),
		SourcePath:      path,
		Provenance:      "durable mesh state",
		responseRefs:    commandRoomWorkedByEvidence(raw["worked_by"]),
		labels:          commandRoomStringSlice(raw["labels"]),
	}
}

func commandRoomWorkedByEvidence(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	var refs []string
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if evidence := commandRoomAnyString(entry["evidence"]); evidence != "" {
			refs = append(refs, evidence)
		}
	}
	return refs
}

func readAllCommandRoomDevelopmentNotices(root string) []commandRoomDevelopmentNotice {
	matches, err := filepath.Glob(filepath.Join(root, "inboxes", "*.yaml"))
	if err != nil {
		return nil
	}
	var notices []commandRoomDevelopmentNotice
	for _, match := range matches {
		var file commandRoomDevelopmentInboxFile
		if err := readYAMLFile(match, &file); err != nil {
			continue
		}
		for _, notice := range file.Notices {
			notices = append(notices, notice.toCommandRoomDevelopmentNotice(match))
		}
	}
	return notices
}

func commandRoomIsEyrieControlItem(item commandRoomDevelopmentWorkItem) bool {
	return item.ID == "task-eyrie-paperclip-control-surface" ||
		item.ParentProjectID == "eyrie-zeroclaw-gui-bridge"
}

func commandRoomControlTerms(item commandRoomDevelopmentWorkItem, parent *commandRoomDevelopmentWorkItem) []string {
	terms := []string{item.ID, item.ParentProjectID}
	for _, ref := range item.SourceRefs {
		terms = append(terms, ref, filepath.Base(ref))
	}
	if parent != nil {
		terms = append(terms, parent.ID)
		for _, ref := range parent.SourceRefs {
			terms = append(terms, ref, filepath.Base(ref))
		}
	}
	return uniqueNonEmpty(terms)
}

func commandRoomNoticeSearchText(notice commandRoomDevelopmentNotice) string {
	return strings.Join(append([]string{
		notice.ID,
		notice.Title,
		notice.Status,
		notice.Priority,
		notice.From,
		notice.Owner,
		notice.Worker,
		notice.Summary,
		notice.Request,
		notice.ResponsePath,
		notice.ApprovalBoundary,
		notice.SourcePath,
	}, notice.ContextRefs...), "\n")
}

func commandRoomTextMatchesAny(text string, terms []string) bool {
	lower := strings.ToLower(text)
	for _, term := range terms {
		term = strings.ToLower(strings.TrimSpace(term))
		if term != "" && strings.Contains(lower, term) {
			return true
		}
	}
	return false
}

func commandRoomArtifactsFromPaths(paths []string, provenance string) []commandRoomArtifactRef {
	var artifacts []commandRoomArtifactRef
	for _, path := range uniqueNonEmpty(paths) {
		if strings.TrimSpace(path) == "" {
			continue
		}
		artifact := commandRoomArtifactRef{
			Path:       path,
			Title:      filepath.Base(path),
			Provenance: provenance,
		}
		if info, err := os.Stat(path); err == nil {
			artifact.ModifiedAt = info.ModTime().UTC().Format(time.RFC3339)
		}
		if strings.EqualFold(filepath.Ext(path), ".md") && fileExists(path) {
			if title, err := readMarkdownTitle(path); err == nil {
				artifact.Title = title
			}
		}
		artifacts = append(artifacts, artifact)
	}
	return artifacts
}

func commandRoomReportArtifacts(paths []string) []commandRoomArtifactRef {
	var reports []commandRoomArtifactRef
	for _, path := range paths {
		if !strings.Contains(path, "/reports/") && !strings.Contains(path, "\\reports\\") {
			continue
		}
		reports = append(reports, commandRoomArtifactsFromPaths([]string{path}, "report artifact")...)
	}
	return reports
}

func commandRoomUniqueArtifacts(items []commandRoomArtifactRef) []commandRoomArtifactRef {
	seen := map[string]struct{}{}
	var out []commandRoomArtifactRef
	for _, item := range items {
		if strings.TrimSpace(item.Path) == "" {
			continue
		}
		if _, ok := seen[item.Path]; ok {
			continue
		}
		seen[item.Path] = struct{}{}
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ModifiedAt == out[j].ModifiedAt {
			return out[i].Path < out[j].Path
		}
		return out[i].ModifiedAt > out[j].ModifiedAt
	})
	return out
}

func readCommandRoomRuntimeSmokes(root string) []commandRoomRuntimeSmoke {
	matches, err := filepath.Glob(filepath.Join(root, "reports", "*runtime-smoke*.md"))
	if err != nil {
		return nil
	}
	var smokes []commandRoomRuntimeSmoke
	for _, match := range matches {
		data, err := os.ReadFile(match)
		if err != nil {
			continue
		}
		text := string(data)
		if !commandRoomDevelopmentMatchesScope(text) {
			continue
		}
		smoke := commandRoomRuntimeSmokeFromMarkdown(match, text)
		if smoke.ID != "" {
			smokes = append(smokes, smoke)
		}
	}
	sort.Slice(smokes, func(i, j int) bool {
		return smokes[i].SourcePath < smokes[j].SourcePath
	})
	return smokes
}

func commandRoomRuntimeSmokeFromMarkdown(path string, text string) commandRoomRuntimeSmoke {
	title, err := readMarkdownTitle(path)
	if err != nil {
		title = filepath.Base(path)
	}
	smoke := commandRoomRuntimeSmoke{
		ID:         strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)),
		Title:      title,
		Status:     commandRoomRuntimeSmokeStatus(text),
		Summary:    "Scratch runtime smoke imported from the Development mesh without launching or controlling a runtime.",
		SourcePath: path,
		Provenance: "runtime telemetry",
	}
	addFact := func(label string, value string, provenance string) {
		value = commandRoomCleanMarkdownValue(value)
		if value == "" {
			return
		}
		smoke.Facts = append(smoke.Facts, commandRoomFact{
			Label:      label,
			Value:      value,
			Provenance: provenance,
			SourcePath: path,
		})
	}

	addFact("PR", commandRoomMarkdownValue(text, "PR"), "durable mesh state")
	addFact("Head tested", commandRoomMarkdownValue(text, "Head tested"), "durable mesh state")
	addFact("Scratch config", commandRoomMarkdownValue(text, "Scratch config"), "durable mesh state")
	addFact("Runtime-resolved workspace", commandRoomMarkdownValue(text, "Runtime-resolved workspace"), "runtime telemetry")
	addFact("Requested worktree", commandRoomMarkdownValue(text, "Requested worktree path"), "durable mesh state")
	addFact("Source worktree", firstNonEmpty(commandRoomMarkdownValue(text, "Real worktree path"), commandRoomMarkdownValue(text, "Requested worktree path")), "durable mesh state")
	addFact("Build log", commandRoomMarkdownValue(text, "Build log"), "runtime telemetry")
	addFact("Gateway logs", commandRoomMarkdownValue(text, "Gateway logs"), "runtime telemetry")
	addFact("Build", commandRoomBulletContaining(text, "cargo build", "passed"), "runtime telemetry")
	addFact("Migration", commandRoomBulletContaining(text, "config migrate", "returned"), "runtime telemetry")
	addFact("Workspace resolution", commandRoomBulletContaining(text, "resolved the workspace"), "runtime telemetry")
	addFact("Port preflight", commandRoomBulletContaining(text, "approved port", "blocked"), "runtime telemetry")
	addFact("Active scratch port", commandRoomFirstSubmatch(text, `(?i)alternate scratch port\s+`+"`?"+`([0-9]+)`+"`?"+`\s+succeeded`), "runtime telemetry")
	addFact("Health", commandRoomBulletContaining(text, "GET /health"), "runtime telemetry")
	addFact("Authenticated APIs", commandRoomBulletContaining(text, "returned unauthorized"), "runtime telemetry")
	addFact("Web asset source", commandRoomFirstSubmatch(text, `(?i)served the web dashboard from\s+(.+?),\s+not from`), "runtime telemetry")
	addFact("Log redaction", commandRoomBulletContaining(text, "redacted"), "runtime telemetry")
	addFact("Next approval", commandRoomNextStep(text), "Eyrie-derived UI state")
	smoke.Findings = commandRoomSectionBullets(text, "Eyrie Dogfood Findings")
	return smoke
}

func commandRoomDevelopmentMatchesScope(text string) bool {
	lower := strings.ToLower(text)
	if !strings.Contains(lower, "6398") && !strings.Contains(lower, "zeroclaw-v080") {
		return false
	}
	return strings.Contains(lower, "eyrie") ||
		strings.Contains(lower, "live-router") ||
		strings.Contains(lower, "pr-6398") ||
		strings.Contains(lower, "zeroclaw-v080-integration-review")
}

func commandRoomRuntimeSmokeStatus(text string) string {
	lower := strings.ToLower(text)
	if strings.Contains(lower, "blocked") || strings.Contains(lower, "unauthorized") || strings.Contains(lower, "failed") || strings.Contains(lower, "warned") {
		return "warning"
	}
	if strings.Contains(lower, "completed") || strings.Contains(lower, "passed") {
		return "completed"
	}
	return "observed"
}

func commandRoomMarkdownValue(text string, label string) string {
	prefix := strings.ToLower(label) + ":"
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
		if strings.HasPrefix(strings.ToLower(trimmed), prefix) {
			return strings.TrimSpace(trimmed[len(label)+1:])
		}
	}
	return ""
}

func commandRoomBulletContaining(text string, needles ...string) string {
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "-") {
			continue
		}
		lower := strings.ToLower(trimmed)
		all := true
		for _, needle := range needles {
			if !strings.Contains(lower, strings.ToLower(needle)) {
				all = false
				break
			}
		}
		if all {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
		}
	}
	return ""
}

func commandRoomSectionBullets(text string, heading string) []string {
	section := commandRoomSection(text, heading)
	if section == "" {
		return nil
	}
	var bullets []string
	for _, line := range strings.Split(section, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "-") {
			bullets = append(bullets, commandRoomCleanMarkdownValue(strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))))
		}
	}
	return bullets
}

func commandRoomNextStep(text string) string {
	section := commandRoomSection(text, "Next Step")
	if section == "" {
		return ""
	}
	var lines []string
	for _, line := range strings.Split(section, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		lines = append(lines, trimmed)
	}
	return strings.Join(lines, " ")
}

func commandRoomSection(text string, heading string) string {
	pattern := regexp.MustCompile(`(?im)^##\s+` + regexp.QuoteMeta(heading) + `\s*$`)
	loc := pattern.FindStringIndex(text)
	if loc == nil {
		return ""
	}
	rest := text[loc[1]:]
	next := regexp.MustCompile(`(?m)^##\s+`).FindStringIndex(rest)
	if next != nil {
		rest = rest[:next[0]]
	}
	return strings.TrimSpace(rest)
}

func commandRoomFirstSubmatch(text string, pattern string) string {
	re := regexp.MustCompile(pattern)
	matches := re.FindStringSubmatch(text)
	if len(matches) < 2 {
		return ""
	}
	return matches[1]
}

func commandRoomCleanMarkdownValue(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "`", "")
	value = strings.Trim(value, "\"'")
	return strings.TrimSpace(value)
}

func commandRoomAnyString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case int:
		return fmt.Sprintf("%d", v)
	case int64:
		return fmt.Sprintf("%d", v)
	case float64:
		if v == float64(int64(v)) {
			return fmt.Sprintf("%d", int64(v))
		}
		return fmt.Sprintf("%g", v)
	default:
		return ""
	}
}

func commandRoomNestedString(raw map[string]any, key string, nested string) string {
	value, ok := raw[key].(map[string]any)
	if !ok {
		return ""
	}
	return commandRoomAnyString(value[nested])
}

func commandRoomStringSlice(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text := commandRoomAnyString(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstString(values []string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
