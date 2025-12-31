// app.js

const CATEGORY_SYSTEM = "https://cch.org.tw/fhir/CodeSystem/larynx-demo-category";
const CATEGORY_CODE = "larynx-ai-report";

const MODEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/model";
const IMAGE_LABEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/image-label";
const RAW_BINARY_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/raw-binary-id";

// === Demo inference endpoint (public HTTPS) ===
// For contest demo: this endpoint can "look up" precomputed results by (model + rawBinaryId) or (model + sha256).
// Replace with your deployed URL, e.g. "https://your-demo-infer.onrender.com"

const INFER_API_BASE = "http://127.0.0.1:50123";


// ------------------------ UI helpers ------------------------
function showStep(step) {
  const step1View = document.getElementById("step1-view");
  const step2View = document.getElementById("step2-view");
  const step1Indicator = document.getElementById("step1-indicator");
  const step2Indicator = document.getElementById("step2-indicator");

  if (step1View && step2View) {
    step1View.style.display = step === 1 ? "block" : "none";
    step2View.style.display = step === 2 ? "block" : "none";
  }
  if (step1Indicator && step2Indicator) {
    if (step === 1) {
      step1Indicator.classList.add("active");
      step2Indicator.classList.remove("active");
    } else {
      step1Indicator.classList.remove("active");
      step2Indicator.classList.add("active");
    }
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null ? "" : String(value);
}

function clearImage(imgId, placeholderId) {
  const img = document.getElementById(imgId);
  const ph = document.getElementById(placeholderId);
  if (img) {
    img.removeAttribute("src");
    img.style.display = "none";
  }
  if (ph) ph.style.display = "block";
}

function setImage(imgId, placeholderId, dataUrl) {
  const img = document.getElementById(imgId);
  const ph = document.getElementById(placeholderId);
  if (ph) ph.style.display = "none";
  if (img && dataUrl) {
    img.src = dataUrl;
    img.style.display = "block";
  }
}

function clearFrame(frameId, placeholderId) {
  const fr = document.getElementById(frameId);
  const ph = document.getElementById(placeholderId);
  if (fr) {
    fr.removeAttribute("src");
    fr.style.display = "none";
  }
  if (ph) ph.style.display = "block";
}

function setFrame(frameId, placeholderId, url) {
  const fr = document.getElementById(frameId);
  const ph = document.getElementById(placeholderId);
  if (ph) ph.style.display = "none";
  if (fr && url) {
    fr.src = url;
    fr.style.display = "block";
  }
}

// ------------------------ FHIR helpers ------------------------
function getIdentifierValue(resource, system) {
  const ids = resource.identifier || [];
  const found = ids.find((id) => id.system === system);
  return found ? found.value : null;
}

function extractBinaryIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split("/");
  return parts[parts.length - 1];
}

async function fetchBinaryResource(client, binaryId) {
  return await client.request("Binary/" + binaryId + "?_format=json", {
    headers: { Accept: "application/fhir+json" }
  });
}

function base64ToUint8Array(b64) {
  const binaryString = atob(b64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function bytesToBlobUrl(bytes, contentType) {
  const blob = new Blob([bytes], { type: contentType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}

// SHA-256 helper (Web Crypto)
async function sha256Hex(u8) {
  if (!u8) return null;
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const out = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return out;
}

// Call demo inference endpoint (can be a lookup service for precomputed outputs)
//
// This demo supports two lookup styles:
// 1) rawBinaryId (recommended for your current THAS demo upload): { model, rawBinaryId }
// 2) sha256 (future upgrade): { model, sha256 }
//
// We'll send both if available; the API can decide which one to use.
async function callDemoInference(model, rawBinaryId, sha256, imageLabel) {
  if (!INFER_API_BASE || INFER_API_BASE.includes("YOUR_PUBLIC_INFER_API")) {
    throw new Error("INFER_API_BASE is not set");
  }
  const url = INFER_API_BASE.replace(/\/+$/, "") + "/predict";

  const payload = { model, imageLabel };
  if (rawBinaryId) payload.rawBinaryId = String(rawBinaryId);
  if (sha256) payload.sha256 = String(sha256);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error("Inference API error: " + resp.status + " " + txt);
  }
  return await resp.json();
}


// ------------------------ Download PDF (preview first) ------------------------
function showReportModal(yes) {
  const m = document.getElementById("reportModal");
  if (!m) return;
  m.style.display = yes ? "flex" : "none";
  m.setAttribute("aria-hidden", yes ? "false" : "true");
  document.body.style.overflow = yes ? "hidden" : "";
}

function mmForA4() {
  return { w: 210, h: 297 };
}

function pxToMm(px, dpi = 96) {
  return (px * 25.4) / dpi;
}

function fitToA4(canvas, marginMm = 10) {
  const a4 = mmForA4();
  const maxW = a4.w - marginMm * 2;
  const maxH = a4.h - marginMm * 2;

  const cwMm = pxToMm(canvas.width);
  const chMm = pxToMm(canvas.height);

  const scale = Math.min(maxW / cwMm, maxH / chMm);
  return {
    w: cwMm * scale,
    h: chMm * scale,
    x: (a4.w - cwMm * scale) / 2,
    y: (a4.h - chMm * scale) / 2
  };
}

async function renderPdfPagesToJsPdf(pdfBytes, jsPdfDoc) {
  const pdfjsLib = (window["pdfjs-dist/build/pdf"] || window.pdfjsLib);
  if (!pdfjsLib) throw new Error("pdfjsLib not loaded");

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    jsPdfDoc.addPage("a4", "p");
    const box = fitToA4(canvas, 6);
    jsPdfDoc.addImage(imgData, "JPEG", box.x, box.y, box.w, box.h);
  }
}

// ------------------------ Main ------------------------
FHIR.oauth2
  .ready()
  .then(async function (client) {
    window.smartClient = client;

    const loadStatus = document.getElementById("loadStatus");
    const modelSelect = document.getElementById("modelSelect");
    const imageSelect = document.getElementById("imageSelect");
    const submitBtn = document.getElementById("submitBtn");
    const form = document.getElementById("metaForm");
    const backBtn = document.getElementById("backBtn");

    const pdfOpenBtn = document.getElementById("aiPdfOpen");
    const downloadReportBtn = document.getElementById("downloadReportBtn");

    const modalClose = document.getElementById("reportModalClose");
    const modalDownload = document.getElementById("reportModalDownload");
    const previewFrame = document.getElementById("reportPreviewFrame");
    const modalTitle = document.getElementById("reportModalTitle");

    showStep(1);

    if (loadStatus) loadStatus.textContent = "Loading demo AI reports from THAS...";

    let docIndex = {}; // docIndex[model][imageLabel] = { rawBinaryId, pngBinaryId, pdfBinaryId }
    let models = new Set();

    // current AI PDF (bytes + blob url)
    let currentAiPdfBytes = null;
    let currentAiPdfBlobUrl = null;

    // generated combined report blob url (for modal preview + download)
    let currentCombinedBlobUrl = null;

    // modal events
    if (modalClose) modalClose.addEventListener("click", () => {
      if (previewFrame) previewFrame.removeAttribute("src");
      showReportModal(false);
    });

    const modal = document.getElementById("reportModal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          if (previewFrame) previewFrame.removeAttribute("src");
          showReportModal(false);
        }
      });
    }

    if (modalDownload) {
      modalDownload.addEventListener("click", () => {
        if (!currentCombinedBlobUrl) {
          alert("尚未產生可下載的 PDF，請先按 Download PDF 預覽。");
          return;
        }
        const a = document.createElement("a");
        a.href = currentCombinedBlobUrl;
        a.download = "AI_Analysis_Report.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }

    async function buildCombinedPdfPreview() {
      const step2 = document.getElementById("step2-view");
      if (!step2 || step2.style.display === "none") {
        alert("請先 Submit 產生 AI Analysis Report。");
        return;
      }
      if (!currentAiPdfBytes) {
        alert("目前沒有 AI Report(PDF) 可以附加，請先 Submit 並確認 AI Report(PDF) 有載入。");
        return;
      }

      // clear old combined blob
      if (currentCombinedBlobUrl) {
        URL.revokeObjectURL(currentCombinedBlobUrl);
        currentCombinedBlobUrl = null;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "p" });

      // --- Page 1: screenshot of Step2 (exclude iframe content)
      const clone = step2.cloneNode(true);

      // remove the top bar (Back/Download) in exported pdf
      const topBar = clone.querySelector(".d-flex.align-items-center.justify-content-between.mb-2");
      if (topBar) topBar.remove();

      // iframe can't be captured reliably; remove it and show hint text
      const iframe = clone.querySelector("#aiPdfFrame");
      if (iframe) iframe.remove();

      const pdfPh = clone.querySelector("#pdfPlaceholder");
      if (pdfPh) {
        pdfPh.style.display = "block";
        pdfPh.textContent = "AI Report (PDF) 已附在下一頁（完整頁面）。";
      }

      // put clone offscreen for capture
      const off = document.createElement("div");
      off.style.position = "fixed";
      off.style.left = "-10000px";
      off.style.top = "0";
      off.style.width = "1120px";
      off.style.background = "#fff";
      off.style.padding = "16px";
      off.appendChild(clone);
      document.body.appendChild(off);

      const canvas = await html2canvas(off, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true
      });

      document.body.removeChild(off);

      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const box = fitToA4(canvas, 8);
      doc.addImage(imgData, "JPEG", box.x, box.y, box.w, box.h);

      // --- Following pages: append AI PDF pages in full
      await renderPdfPagesToJsPdf(currentAiPdfBytes, doc);

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      currentCombinedBlobUrl = url;

      if (modalTitle) {
        modalTitle.textContent =
          "Preview: AI Analysis Report (Page 1) + AI Report(PDF) (Following Pages)";
      }
      if (previewFrame) previewFrame.src = url;

      showReportModal(true);
    }

    if (downloadReportBtn) {
      downloadReportBtn.addEventListener("click", async () => {
        downloadReportBtn.disabled = true;
        downloadReportBtn.textContent = "Generating...";
        try {
          await buildCombinedPdfPreview();
        } catch (e) {
          console.error(e);
          alert("產生預覽 PDF 失敗，請看 console。");
        } finally {
          downloadReportBtn.disabled = false;
          downloadReportBtn.textContent = "Download PDF";
        }
      });
    }

    // === 1) Search DocumentReference ===
    try {
      const searchParam = encodeURIComponent(CATEGORY_SYSTEM + "|" + CATEGORY_CODE);
      const url = "DocumentReference?category=" + searchParam + "&_count=50";

      const bundle = await client.request(url, {
        headers: { Accept: "application/fhir+json" }
      });

      const entries = bundle.entry || [];
      if (entries.length === 0) {
        if (loadStatus) {
          loadStatus.className = "alert alert-warning py-2 mb-3";
          loadStatus.textContent = "No demo AI reports found in THAS (DocumentReference).";
        }
      } else {
        entries.forEach((e) => {
          const doc = e.resource;
          if (!doc || doc.resourceType !== "DocumentReference") return;

          const model = getIdentifierValue(doc, MODEL_SYSTEM);
          const imageLabel = getIdentifierValue(doc, IMAGE_LABEL_SYSTEM);
          const rawBinaryId = getIdentifierValue(doc, RAW_BINARY_SYSTEM);
          if (!model || !imageLabel) return;

          const contents = doc.content || [];
          let pngBinaryId = null;
          let pdfBinaryId = null;

          contents.forEach((c) => {
            const att = c.attachment || c;
            if (!att || !att.url) return;
            if ((att.contentType || "").includes("png")) {
              pngBinaryId = extractBinaryIdFromUrl(att.url);
            } else if ((att.contentType || "").includes("pdf")) {
              pdfBinaryId = extractBinaryIdFromUrl(att.url);
            }
          });

          if (!docIndex[model]) docIndex[model] = {};
          if (!docIndex[model][imageLabel]) {
            docIndex[model][imageLabel] = { model, imageLabel, rawBinaryId, pngBinaryId, pdfBinaryId };
          }
          models.add(model);
        });

        if (models.size === 0) {
          if (loadStatus) {
            loadStatus.className = "alert alert-warning py-2 mb-3";
            loadStatus.textContent = "Demo DocumentReference found, but missing identifiers.";
          }
        } else {
          if (loadStatus) {
            loadStatus.className = "alert alert-success py-2 mb-3";
            loadStatus.textContent = "Demo AI reports loaded. Please select model and test image.";
          }

          if (modelSelect) {
            modelSelect.innerHTML = '<option value="">Pick a model</option>';
            Array.from(models).sort().forEach((m) => {
              const opt = document.createElement("option");
              opt.value = m;
              opt.textContent = m;
              modelSelect.appendChild(opt);
            });
            modelSelect.disabled = false;
          }
        }
      }
    } catch (err) {
      console.error(err);
      if (loadStatus) {
        loadStatus.className = "alert alert-danger py-2 mb-3";
        loadStatus.textContent = "Failed to load demo AI reports from THAS. See console.";
      }
    }

    // === 2) Model change -> update image list ===
    if (modelSelect) {
      modelSelect.addEventListener("change", function () {
        const model = modelSelect.value;
        if (imageSelect) imageSelect.innerHTML = "";

        if (!model || !docIndex[model]) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "Select a model first";
          if (imageSelect) imageSelect.appendChild(opt);
          if (imageSelect) imageSelect.disabled = true;
          if (submitBtn) submitBtn.disabled = true;
          return;
        }

        const images = Object.keys(docIndex[model]).sort();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Pick a test image";
        if (imageSelect) imageSelect.appendChild(placeholder);

        images.forEach((label) => {
          const opt = document.createElement("option");
          opt.value = label;
          opt.textContent = label;
          if (imageSelect) imageSelect.appendChild(opt);
        });

        if (imageSelect) imageSelect.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
      });
    }

    // === 3) Submit -> load BMP/PNG/PDF ===
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();

        const model = modelSelect ? modelSelect.value : "";
        const imageLabel = imageSelect ? imageSelect.value : "";

        if (!model || !imageLabel || !docIndex[model] || !docIndex[model][imageLabel]) {
          alert("Selected combination has no demo report. Please re-select.");
          return;
        }

        const mapping = docIndex[model][imageLabel];

        const payload = {
          patientName: (document.getElementById("patientName")?.value || "").trim(),
          patientSex: document.getElementById("patientSex")?.value || "",
          patientAge: document.getElementById("patientAge")?.value || "",
          examDate: document.getElementById("examDate")?.value || "",
          model,
          imageLabel
        };

        showStep(2);

        setText("infoName", payload.patientName);
        setText("infoSexAge", payload.patientSex + " / " + payload.patientAge);
        setText("infoExamDate", payload.examDate);
        setText("infoModel", payload.model);
        setText("infoImage", payload.imageLabel);

        setText("infoRunId", "");
        setText("infoSha256", "");

        clearImage("previewImage", "rawPlaceholder");
        clearImage("aiSummaryImage", "pngPlaceholder");
        clearFrame("aiPdfFrame", "pdfPlaceholder");

        if (pdfOpenBtn) {
          pdfOpenBtn.style.display = "none";
          pdfOpenBtn.href = "#";
        }

        // release old AI pdf url
        if (currentAiPdfBlobUrl) {
          URL.revokeObjectURL(currentAiPdfBlobUrl);
          currentAiPdfBlobUrl = null;
        }
        currentAiPdfBytes = null;

        try {
          // 1) Fetch RAW BMP from THAS (this is the inference input)
          let rawBytes = null;
          let inputSha = null;

          if (mapping.rawBinaryId) {
            const rawBin = await fetchBinaryResource(client, mapping.rawBinaryId);
            if (rawBin && rawBin.data) {
              const ct = rawBin.contentType || "application/octet-stream";
              const rawUrl = `data:${ct};base64,${rawBin.data}`;
              setImage("previewImage", "rawPlaceholder", rawUrl);

              rawBytes = base64ToUint8Array(rawBin.data);
              try {
              inputSha = await sha256Hex(rawBytes);
              setText("infoSha256", inputSha);
            } catch (shaErr) {
              console.warn("SHA-256 failed (non-secure context or crypto not available).", shaErr);
              inputSha = null;
              setText("infoSha256", "");
            }
}
          }

          // 2) Call demo inference endpoint (can be a lookup service for precomputed outputs)
          let predictedPngId = null;
          let predictedPdfId = null;
          let runId = null;

          if (mapping.rawBinaryId || inputSha) {
            try {
              const pred = await callDemoInference(payload.model, mapping.rawBinaryId, inputSha, payload.imageLabel);

              // Accept both camelCase and snake_case response fields
              predictedPngId = pred.pngBinaryId || pred.png_binary_id || null;
              predictedPdfId = pred.pdfBinaryId || pred.pdf_binary_id || null;
              runId = pred.runId || pred.run_id || null;
            } catch (inferErr) {
              console.warn("Demo inference failed, fallback to THAS DocumentReference attachments.", inferErr);
              runId = "N/A (fallback)";
              predictedPngId = mapping.pngBinaryId || null;
              predictedPdfId = mapping.pdfBinaryId || null;
            }
          } else {
            runId = "N/A";
            predictedPngId = mapping.pngBinaryId || null;
            predictedPdfId = mapping.pdfBinaryId || null;
          }

          setText("infoRunId", runId);

          // 3) Load predicted outputs (PNG/PDF) from THAS by Binary id
          // PNG
          if (predictedPngId) {
            const pngBin = await fetchBinaryResource(client, predictedPngId);
            if (pngBin && pngBin.data) {
              const ct = pngBin.contentType || "image/png";
              const pngUrl = `data:${ct};base64,${pngBin.data}`;
              setImage("aiSummaryImage", "pngPlaceholder", pngUrl);
            }
          }

          // PDF
          if (predictedPdfId) {
            const pdfBin = await fetchBinaryResource(client, predictedPdfId);
            if (pdfBin && pdfBin.data) {
              const ct = pdfBin.contentType || "application/pdf";
              const bytes = base64ToUint8Array(pdfBin.data);
              currentAiPdfBytes = bytes;

              const blobUrl = bytesToBlobUrl(bytes, ct);
              currentAiPdfBlobUrl = blobUrl;

              setFrame("aiPdfFrame", "pdfPlaceholder", blobUrl);

              if (pdfOpenBtn) {
                pdfOpenBtn.href = blobUrl;
                pdfOpenBtn.style.display = "inline-flex";
              }
            }
          }
        } catch (err) {
          console.error(err);
          alert("Error loading images/reports from THAS. See console.");
        }
      });
    }

    // Back -> Step 1
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        showStep(1);
      });
    }
  })
  .catch(function (error) {
    console.error(error);
    alert("SMART authorization failed. See console.");
  });

