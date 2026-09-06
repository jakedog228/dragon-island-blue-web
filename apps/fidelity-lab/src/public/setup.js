const $ = (selector) => document.querySelector(selector);
let setup;
let starting = false;

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return body;
}

function showError(error) {
  const element = $("#setup-error");
  element.textContent = String(error);
  element.classList.remove("hidden");
}

function choices(select, items, emptyLabel) {
  select.replaceChildren();
  if (items.length === 0) {
    const option = new Option(emptyLabel, "");
    option.disabled = true;
    option.selected = true;
    select.add(option);
    return;
  }
  for (const item of items) select.add(new Option(item.label, item.id));
}

function selectedTask() {
  return setup.tasks.find(({ id }) => id === $("#task-choice").value);
}

function renderTask() {
  const task = selectedTask();
  $("#task-preview").replaceChildren();
  if (!task) return;
  const recommended = setup.saves.find(({ sha256 }) => sha256 === task.recommendedSaveSha256);
  if (recommended) $("#save-choice").value = recommended.id;
  const title = document.createElement("h3");
  title.textContent = task.title;
  const purpose = document.createElement("p");
  purpose.textContent = task.purpose;
  const setupList = document.createElement("ul");
  for (const text of task.setup) {
    const item = document.createElement("li"); item.textContent = text; setupList.append(item);
  }
  const review = document.createElement("p");
  review.className = "task-review-label";
  review.textContent = `Review: ${task.reviewFocus.join(" · ")}`;
  const saveStatus = document.createElement("p");
  saveStatus.className = recommended ? "task-save-ready" : "task-save-missing";
  saveStatus.textContent = recommended
    ? `Matched save ready: ${recommended.label}`
    : "This task needs its matched save. Choose or upload the save described by the task.";
  $("#task-preview").append(title, purpose, setupList, saveStatus, review);
}

function workflowChanged() {
  const workflow = new FormData($("#setup-form")).get("workflow");
  const waitForViewerSync = workflow === "live" && $("#wait-for-viewer-sync").checked;
  const portAudio = workflow === "live" && $("#port-audio").checked;
  document.querySelectorAll(".workflow-card").forEach((card) => {
    card.classList.toggle("selected", card.querySelector("input").checked);
  });
  $("#viewer-wait-option").classList.toggle("hidden", workflow !== "live");
  $("#viewer-wait-option").classList.toggle("selected", waitForViewerSync);
  $("#port-audio-option").classList.toggle("hidden", workflow !== "live");
  $("#port-audio-option").classList.toggle("selected", portAudio);
  $("#task-step").classList.toggle("hidden", workflow !== "task");
  $("#launch-title").textContent = workflow === "task" ? "Run automated comparison" : "Start live comparison";
  $("#start-session").textContent = workflow === "task" ? "Start and run task" : "Start comparison";
  $("#launch-summary").textContent = workflow === "task"
    ? "The lab launches both runtimes, executes the native and port inputs, then opens the evidence workspace."
    : waitForViewerSync
      ? "The lab waits for each TouchHLE viewer frame, matches the nearest web frame, and advances both panels together."
      : "The lab opens independent low-latency native and web streams for the fastest mirrored-input workspace.";
}

async function upload(kind, file) {
  if (!file) return;
  const input = $(`#${kind}-upload`);
  input.disabled = true;
  try {
    const item = await api(`/api/uploads/${kind}`, {
      method: "POST",
      headers: { "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    const select = $(`#${kind}-choice`);
    select.add(new Option(`${item.label} (selected)`, item.id));
    select.value = item.id;
    if (kind === "save") {
      setup.saves.push({ id: item.id, label: item.label, sha256: item.sha256, uploaded: true });
      renderTask();
    }
  } finally {
    input.disabled = false;
  }
}

function renderEnvironment() {
  const native = document.createElement("span");
  native.className = `status ${setup.environment.nativePackageAvailable ? "ok" : "bad"}`;
  native.textContent = setup.environment.nativePackageAvailable ? "TouchHLE ready" : "TouchHLE package missing";
  const web = document.createElement("span");
  web.className = "status ok";
  web.textContent = "Web port managed";
  $("#environment").replaceChildren(native, web);
}

function renderActive(session) {
  const panel = $("#active-session");
  if (!session || session.state === "stopped") {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const title = session.workflow === "task"
    ? "Automated task"
    : session.waitForViewerSync ? "Live comparison · Wait" : "Live comparison";
  panel.innerHTML = `<div><div class="eyebrow">Current session</div><h2>${title}</h2><p>${session.message ?? session.state}</p></div>`;
  const actions = document.createElement("div");
  actions.className = "button-row";
  if (session.dashboardUrl) {
    const resume = document.createElement("a");
    resume.className = "button-link primary-action";
    resume.href = session.dashboardUrl;
    resume.textContent = "Open comparison";
    actions.append(resume);
  }
  const end = document.createElement("button");
  end.textContent = "End session";
  end.addEventListener("click", async () => {
    await api(`/api/sessions/${encodeURIComponent(session.id)}/stop`, { method: "POST" });
    location.reload();
  });
  actions.append(end);
  panel.append(actions);
}

async function pollSession(id) {
  for (;;) {
    const session = await api(`/api/sessions/${encodeURIComponent(id)}`);
    $("#launch-message").textContent = session.message;
    if (session.state === "ready") {
      location.assign(session.dashboardUrl);
      return;
    }
    if (session.state === "error") throw new Error(session.error ?? session.message);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

$("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (starting) return;
  starting = true;
  $("#setup-error").classList.add("hidden");
  $("#setup-form").classList.add("hidden");
  $("#launch-progress").classList.remove("hidden");
  try {
    const workflow = new FormData(event.currentTarget).get("workflow");
    const session = await api("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflow,
        waitForViewerSync: workflow === "live" && $("#wait-for-viewer-sync").checked,
        portAudio: workflow === "live" && $("#port-audio").checked,
        archiveId: $("#archive-choice").value,
        saveId: $("#save-choice").value,
        taskId: workflow === "task" ? $("#task-choice").value : undefined,
        contentRights: $("#content-rights").checked,
      }),
    });
    await pollSession(session.id);
  } catch (error) {
    showError(error);
    $("#launch-progress").classList.add("hidden");
    $("#setup-form").classList.remove("hidden");
    starting = false;
  }
});

document.querySelectorAll('input[name="workflow"]').forEach((input) => input.addEventListener("change", workflowChanged));
$("#wait-for-viewer-sync").addEventListener("change", workflowChanged);
$("#port-audio").addEventListener("change", workflowChanged);
$("#task-choice").addEventListener("change", renderTask);
$("#archive-upload").addEventListener("change", (event) => void upload("archive", event.target.files[0]).catch(showError));
$("#save-upload").addEventListener("change", (event) => void upload("save", event.target.files[0]).catch(showError));

try {
  setup = await api("/api/setup");
  renderEnvironment();
  choices($("#archive-choice"), setup.archives, "Choose an archive file");
  choices($("#save-choice"), setup.saves, "Choose a save file");
  choices($("#task-choice"), setup.tasks.map(({ id, title }) => ({ id, label: title })), "No tasks available");
  renderTask();
  workflowChanged();
  renderActive(setup.activeSession);
} catch (error) {
  showError(error);
}
