package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"concord/internal/snowflake"
)

// UploadResponse represents the response when an image or file is successfully uploaded
type UploadResponse struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

// UploadHandler manages file uploads
type UploadHandler struct {
	snowflake *snowflake.Generator
	uploadDir string
}

// NewUploadHandler creates a new UploadHandler
func NewUploadHandler(sf *snowflake.Generator, uploadDir string) *UploadHandler {
	_ = os.MkdirAll(uploadDir, 0755)
	return &UploadHandler{
		snowflake: sf,
		uploadDir: uploadDir,
	}
}

// UploadFile handles POST /uploads multipart/form-data requests
func (h *UploadHandler) UploadFile(w http.ResponseWriter, r *http.Request) {
	// Limit request body to 25MB
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)

	if err := r.ParseMultipartForm(25 << 20); err != nil {
		WriteError(w, http.StatusBadRequest, "FILE_TOO_LARGE", "Arquivo muito grande. O limite máximo é de 25 MB.")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_FILE", "Nenhum arquivo enviado ou campo 'file' ausente.")
		return
	}
	defer file.Close()

	// Sniff first 512 bytes for MIME type
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	contentType := http.DetectContentType(buf[:n])
	// Reset file reader offset
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Falha ao processar arquivo.")
		return
	}

	// Allowed image MIME types mapping
	allowedTypes := map[string]string{
		"image/png":  ".png",
		"image/jpeg": ".jpg",
		"image/gif":  ".gif",
		"image/webp": ".webp",
	}

	ext, ok := allowedTypes[contentType]
	if !ok {
		// Fallback to filename extension if MIME type sniffing returned application/octet-stream
		origExt := strings.ToLower(filepath.Ext(header.Filename))
		if origExt == ".png" || origExt == ".jpg" || origExt == ".jpeg" || origExt == ".gif" || origExt == ".webp" {
			ext = origExt
			if ext == ".jpeg" {
				ext = ".jpg"
			}
			contentType = "image/" + strings.TrimPrefix(ext, ".")
		} else {
			WriteError(w, http.StatusBadRequest, "UNSUPPORTED_TYPE", "Apenas imagens (PNG, JPG, GIF, WebP) são suportadas.")
			return
		}
	}

	// Generate Snowflake ID for file
	fileID, err := h.snowflake.NextID()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Falha ao gerar identificador único do arquivo.")
		return
	}

	savedFilename := fmt.Sprintf("%d%s", fileID, ext)
	targetPath := filepath.Join(h.uploadDir, savedFilename)

	dst, err := os.Create(targetPath)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Falha ao salvar arquivo no servidor.")
		return
	}
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Falha ao gravar arquivo no disco.")
		return
	}

	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	baseURL := fmt.Sprintf("%s://%s", scheme, r.Host)
	fileURL := fmt.Sprintf("%s/uploads/%s", baseURL, savedFilename)

	WriteJSON(w, http.StatusCreated, UploadResponse{
		ID:          fileID.String(),
		URL:         fileURL,
		Filename:    header.Filename,
		ContentType: contentType,
		Size:        written,
	})
}
