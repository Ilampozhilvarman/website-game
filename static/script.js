const toggleButton = document.getElementById('toggle');

function setTheme(theme) {
	document.documentElement.dataset.theme = theme;
	try {
		localStorage.setItem('theme', theme);
	} catch (e) {
		// ignore
	}
	if (toggleButton) {
		const isDark = theme === 'dark';
		toggleButton.setAttribute('aria-pressed', isDark ? 'true' : 'false');
		toggleButton.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
	}
}

function initTheme() {
	const current = document.documentElement.dataset.theme || 'light';
	setTheme(current);
}

if (toggleButton) {
	toggleButton.addEventListener('click', () => {
		const current = document.documentElement.dataset.theme || 'light';
		setTheme(current === 'dark' ? 'light' : 'dark');
	});
}

initTheme();

// --- Screen switching (each screen is one div; page never reloads) ---
const screenEl = document.getElementById('screen');

const screens = {
	menu: `
		<div class="box">
			<h2>Title</h2>
			<hr class="divider">
			<button type="button" data-goto="local">On this device</button>
			<button type="button" data-goto="online">On two different devices</button>
		</div>`,
	local: `
		<div class="box">
			<h2>On this device</h2>
			<hr class="divider">
			<button type="button" data-goto="game">Start game</button>
			<button type="button" data-goto="menu">Back</button>
		</div>`,
	online: `
		<div class="box">
			<h2>On two different devices</h2>
			<hr class="divider">
			<p id="online-status">Online game goes here.</p>
			<button type="button" data-goto="game">Start game</button>
			<button type="button" data-goto="menu">Back</button>
		</div>`,
	game: `
		<div class="box">
			<h2>Game</h2>
			<hr class="divider" id="game-divider">
			<div id="game-holder">
				<div class="player" id="player1">
					<h3>Player 1</h3>
					<div class="hand">Left hand<span class="bullets" id="p1-left">Bullets: 0</span></div>
					<div class="hand">Right hand<span class="bullets" id="p1-right">Bullets: 0</span></div>
				</div>
				<div class="vdivider"></div>
				<div class="player" id="player2">
					<h3>Player 2</h3>
					<div class="hand">Left hand<span class="bullets" id="p2-left">Bullets: 0</span></div>
					<div class="hand">Right hand<span class="bullets" id="p2-right">Bullets: 0</span></div>
				</div>
			</div>
			<button type="button" data-goto="menu">Quit to menu</button>
		</div>`,
};

// Bullets per hand. Reload adds 1; Shoot spends from the hand(s) used.
const bullets = {
	p1: { left: 0, right: 0 },
	p2: { left: 0, right: 0 },
};

function renderBullets() {
	for (const player of ['p1', 'p2']) {
		for (const hand of ['left', 'right']) {
			const el = document.getElementById(`${player}-${hand}`);
			if (el) el.textContent = `Bullets: ${bullets[player][hand]}`;
		}
	}
}

function showScreen(name) {
	if (!screens[name]) return;
	screenEl.innerHTML = screens[name];
	if (name === 'game') renderBullets();
	// Hook for later: open the WebSocket when entering 'online',
	// close it when leaving.
}

document.addEventListener('click', (event) => {
	const target = event.target.closest('[data-goto]');
	if (target) {
		showScreen(target.dataset.goto);
	}
});

showScreen('menu');
