package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"

	"pi-chat-gateway/internal/db"
	"pi-chat-gateway/internal/llm"
	"pi-chat-gateway/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	dataDir := flag.String("data", "./data", "data directory for JSON storage")
	rolesDir := flag.String("roles", server.DefaultRolesDir, "directory containing role .txt files")
	model := flag.String("model", server.DefaultModel, "default Ollama model name")
	llmDump := flag.String("llm-dump", "", "if set, directory where raw LLM requests/responses are dumped")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatalf("failed to create data dir: %v", err)
	}

	store, err := db.NewJSONStore(*dataDir)
	if err != nil {
		log.Fatalf("failed to init store: %v", err)
	}

	llmClient := llm.NewClient()
	if *llmDump != "" {
		if err := os.MkdirAll(*llmDump, 0o755); err != nil {
			log.Fatalf("failed to create llm dump dir: %v", err)
		}
		llmClient.DumpDir = *llmDump
		log.Printf("llm dump enabled: %s", filepath.Clean(*llmDump))
	}

	cfg := server.DefaultConfig()
	cfg.RolesDir = *rolesDir
	cfg.Model = *model

	log.Printf("Vivid Mistress listening on %s (data: %s, roles: %s, model: %s)",
		*addr, filepath.Clean(*dataDir), filepath.Clean(*rolesDir), *model)
	if err := server.RunWithConfig(*addr, store, llmClient, cfg); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
