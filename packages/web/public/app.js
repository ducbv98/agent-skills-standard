"use strict";

const form = document.getElementById("url-form");
const urlInput = document.getElementById("url-input");
const submitBtn = document.getElementById("submit-btn");
const formHint = document.getElementById("form-hint");
const progressCard = document.getElementById("progress-card");
const reviewCard = document.getElementById("review-card");
const reviewVideo = document.getElementById("review-video");
const downloadLink = document.getElementById("download-link");
const errorBox = document.getElementById("error-box");

const STEP_ICONS = { pending: "○", running: "●", done: "✓", error: "✗" };

function setStepStatus(step, status, message) {
  const li = document.querySelector(`.steps li[data-step="${step}"]`);
  if (!li) return;
  li.classList.remove("running", "done", "error");
  if (status === "running") li.classList.add("running");
  else if (status === "done") li.classList.add("done");
  else if (status === "error") li.classList.add("error");

  const icon = li.querySelector(".icon");
  if (icon) icon.textContent = STEP_ICONS[status] ?? STEP_ICONS.pending;

  if (message !== undefined) {
    const msg = li.querySelector(".msg");
    if (msg) msg.textContent = message;
  }
}

function resetUI() {
  progressCard.classList.add("hidden");
  reviewCard.classList.add("hidden");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
  for (const li of document.querySelectorAll(".steps li")) {
    li.classList.remove("running", "done", "error");
    li.querySelector(".icon").textContent = STEP_ICONS.pending;
    li.querySelector(".msg").textContent = "";
  }
  reviewVideo.removeAttribute("src");
  reviewVideo.load();
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

async function startJob(url) {
  resetUI();
  submitBtn.disabled = true;
  submitBtn.textContent = "Đang xử lý...";
  formHint.textContent = "Bạn có thể giữ tab này mở. Pipeline chạy trên server.";
  progressCard.classList.remove("hidden");

  let jobId;
  try {
    const resp = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    jobId = data.id;
  } catch (err) {
    showError(`Không tạo được job: ${err.message ?? err}`);
    resetSubmit();
    return;
  }

  subscribeJob(jobId);
}

function subscribeJob(jobId) {
  const es = new EventSource(`/api/jobs/${jobId}/events`);

  es.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleProgressEvent(event);
    } catch (err) {
      console.warn("Bad SSE payload", err);
    }
  };

  es.addEventListener("end", (e) => {
    let payload = {};
    try {
      payload = JSON.parse(e.data);
    } catch {
      // ignore
    }
    es.close();
    if (payload.status === "done" && payload.outputFileName) {
      showReview(jobId, payload.outputFileName);
    } else if (payload.status === "error") {
      showError(payload.error ?? "Pipeline thất bại — xem console server để biết chi tiết.");
    }
    resetSubmit();
  });

  es.onerror = () => {
    // EventSource auto-reconnect; chỉ hiện lỗi nếu đã close
    if (es.readyState === EventSource.CLOSED) {
      showError("Mất kết nối tới server.");
      resetSubmit();
    }
  };
}

function handleProgressEvent(event) {
  if (event.step === "done") {
    // event tổng — không thuộc step bar
    if (event.status === "error") {
      showError(event.message);
    }
    return;
  }
  setStepStatus(event.step, event.status === "done" ? "done" : "running", event.message);
}

function showReview(jobId, fileName) {
  const url = `/api/jobs/${jobId}/video`;
  reviewVideo.src = url;
  reviewVideo.load();
  downloadLink.href = url;
  downloadLink.setAttribute("download", fileName);
  reviewCard.classList.remove("hidden");
  reviewVideo.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetSubmit() {
  submitBtn.disabled = false;
  submitBtn.textContent = "Dub video";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  startJob(url);
});
