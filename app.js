const approvalForm = document.querySelector("#approval-form");
const decisionInput = document.querySelector("#decision");
const reviewerInput = document.querySelector("#reviewer");
const commentsInput = document.querySelector("#comments");
const helperText = document.querySelector("#form-helper");
const statusLabel = document.querySelector("#current-status");
const statusDetail = document.querySelector("#status-detail");
const historyList = document.querySelector("#history-list");
const resetButton = document.querySelector("#reset");
const clearHistoryButton = document.querySelector("#clear-history");

const statusCopy = {
  approved: {
    label: "Approved",
    detail: "Employee has been notified of the approval.",
  },
  denied: {
    label: "Denied",
    detail: "Employee has been notified of the decision.",
  },
  "needs-info": {
    label: "Needs More Info",
    detail: "Waiting on additional information from the employee.",
  },
};

const formatDateTime = (date) =>
  date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const resetForm = () => {
  approvalForm.reset();
  helperText.textContent = "";
};

const updateStatus = (decision) => {
  statusLabel.textContent = statusCopy[decision].label;
  statusDetail.textContent = statusCopy[decision].detail;
  statusLabel.className = `status ${decision}`;
};

const addHistoryItem = ({ decision, reviewer, comments }) => {
  const listItem = document.createElement("li");
  const pill = document.createElement("span");
  const content = document.createElement("div");
  const title = document.createElement("p");
  const meta = document.createElement("p");

  pill.className = `history-pill ${decision}`;
  pill.textContent = statusCopy[decision].label;

  title.className = "history-title";
  title.textContent = `${statusCopy[decision].label} by ${reviewer}`;

  meta.className = "history-meta";
  meta.textContent = `${formatDateTime(new Date())}${comments ? ` · ${comments}` : ""}`;

  content.append(title, meta);
  listItem.append(pill, content);
  historyList.prepend(listItem);
};

approvalForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const decision = decisionInput.value;
  const reviewer = reviewerInput.value.trim();
  const comments = commentsInput.value.trim();

  if (!decision || !reviewer) {
    helperText.textContent = "Please select a decision and add your name.";
    return;
  }

  helperText.textContent = "";
  updateStatus(decision);
  addHistoryItem({ decision, reviewer, comments });
  resetForm();
});

resetButton.addEventListener("click", () => {
  resetForm();
});

clearHistoryButton.addEventListener("click", () => {
  const firstItem = historyList.querySelector("li");
  historyList.innerHTML = "";
  if (firstItem) {
    historyList.append(firstItem);
  }
});
