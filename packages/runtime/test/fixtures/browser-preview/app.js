const modeButtons = [...document.querySelectorAll("[data-mode]")];
const sliders = [...document.querySelectorAll('input[type="range"]')];
const state = document.querySelector("#state");
const canvas = document.querySelector("#plot");
const context = canvas.getContext("2d");

function render() {
  const mode =
    modeButtons.find((button) => button.getAttribute("aria-pressed") === "true")
      ?.dataset.mode ?? "circle";
  const values = sliders.map((slider) => slider.value || "5");
  state.textContent = `${mode}:${values.join(":")}`;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#c9654d";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(40, 200);
  context.lineTo(680, 40 + Number(values[0]) * 8);
  context.stroke();
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    for (const candidate of modeButtons) {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    }
    render();
  });
}
for (const slider of sliders) {
  slider.value = "5";
  slider.addEventListener("input", render);
}
render();
