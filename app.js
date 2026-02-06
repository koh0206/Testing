const requests = [
  {
    id: "REQ-1024",
    employee: "Jordan Matthews",
    type: "Vacation",
    start: "2024-07-18",
    end: "2024-07-22",
    coverage: "Sam will handle client updates and the weekly report.",
    balance: 9,
    submitted: "Today, 9:10 AM",
  },
  {
    id: "REQ-1025",
    employee: "Amira Khan",
    type: "Personal",
    start: "2024-07-20",
    end: "2024-07-20",
    coverage: "Paige is covering inbox triage for the day.",
    balance: 5,
    submitted: "Yesterday, 4:45 PM",
  },
  {
    id: "REQ-1026",
    employee: "Diego Alvarez",
    type: "Training",
    start: "2024-07-29",
    end: "2024-07-31",
    coverage: "Marcus will lead daily standups and client calls.",
    balance: 12,
    submitted: "Yesterday, 2:10 PM",
  },
];

const list = document.querySelector("#request-list");
const template = document.querySelector("#request-card");
const pendingCount = document.querySelector("#pending-count");
const approvedCount = document.querySelector("#approved-count");
const form = document.querySelector("#request-form");

let approvedToday = 0;

function formatRange(start, end) {
  const options = { month: "short", day: "numeric" };
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startText = startDate.toLocaleDateString("en-US", options);
  const endText = endDate.toLocaleDateString("en-US", options);
  return start === end ? startText : `${startText} → ${endText}`;
}

function calculateDays(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
  return diff + 1;
}

function updateSummary() {
  pendingCount.textContent = requests.length.toString();
  approvedCount.textContent = approvedToday.toString();
}

function renderRequests() {
  list.innerHTML = "";

  requests.forEach((request) => {
    const card = template.content.cloneNode(true);
    card.querySelector(".employee-name").textContent = request.employee;
    card.querySelector(".meta").textContent = `${request.type} • ${formatRange(
      request.start,
      request.end
    )}`;
    card.querySelector(".badge").textContent = request.id;
    card.querySelector(".coverage").textContent = request.coverage;
    card.querySelector(".balance").textContent = `${request.balance} days`;
    card.querySelector(".days").textContent = `${calculateDays(
      request.start,
      request.end
    )} days`;
    card.querySelector(".submitted").textContent = request.submitted;

    const approveButton = card.querySelector(".approve");
    const declineButton = card.querySelector(".decline");

    approveButton.addEventListener("click", () => handleDecision(request.id, true));
    declineButton.addEventListener("click", () => handleDecision(request.id, false));

    list.appendChild(card);
  });

  if (requests.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "All caught up! No pending approvals.";
    list.appendChild(empty);
  }

  updateSummary();
}

function handleDecision(id, approved) {
  const index = requests.findIndex((request) => request.id === id);
  if (index === -1) return;

  requests.splice(index, 1);
  if (approved) {
    approvedToday += 1;
  }
  renderRequests();
}

function addRequest(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const employee = data.get("employee");
  const type = data.get("type");
  const start = data.get("start");
  const end = data.get("end");
  const coverage = data.get("coverage");

  if (!employee || !type || !start || !end || !coverage) return;

  requests.unshift({
    id: `REQ-${Math.floor(Math.random() * 9000 + 1000)}`,
    employee,
    type,
    start,
    end,
    coverage,
    balance: Math.floor(Math.random() * 10 + 5),
    submitted: "Just now",
  });

  event.target.reset();
  renderRequests();
}

form.addEventListener("submit", addRequest);

renderRequests();
