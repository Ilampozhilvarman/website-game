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
			<p id="online-status">Create a game and share the code, or enter a friend's code.</p>
			<button type="button" id="create-game">Create game</button>
			<input type="text" id="join-code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" aria-label="Game code">
			<button type="button" id="join-game">Join game</button>
			<button type="button" data-goto="menu">Back</button>
		</div>`,
	game: `
		<div class="box">
			<h2>Game</h2>
			<hr class="divider" id="game-divider">
			<div id="hud">
				<span id="turn-label">Turn 1</span>
				<div id="timer-track"><div id="timer-fill"></div></div>
				<span id="timer-text"></span>
			</div>
			<div id="game-holder">
				<div id="banner"></div>
				<div class="player" id="player1">
					<h3>Player 1</h3>
					<span class="ready" id="p1-ready"></span>
					<span class="result" id="p1-result"></span>
					<div class="hand">Left hand<span class="bullets" id="p1-left"></span><span class="keys" id="p1-left-keys"></span></div>
					<div class="hand">Right hand<span class="bullets" id="p1-right"></span><span class="keys" id="p1-right-keys"></span></div>
				</div>
				<div class="vdivider"></div>
				<div class="player" id="player2">
					<h3>Player 2</h3>
					<span class="ready" id="p2-ready"></span>
					<span class="result" id="p2-result"></span>
					<div class="hand">Left hand<span class="bullets" id="p2-left"></span><span class="keys" id="p2-left-keys"></span></div>
					<div class="hand">Right hand<span class="bullets" id="p2-right"></span><span class="keys" id="p2-right-keys"></span></div>
				</div>
			</div>
			<p id="game-status"></p>
			<div class="help-overlay" id="help" hidden>
				<div class="help-card">
					<h3>How to play</h3>
					<ul>
					<li>Both players pick one move each turn using the keyboard. Moves are revealed together.</li>
					<li><b>Player 1:</b> left hand <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> <kbd>5</kbd>, right hand <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>T</kbd></li>
					<li><b>Player 2:</b> left hand <kbd>6</kbd> <kbd>7</kbd> <kbd>8</kbd> <kbd>9</kbd> <kbd>0</kbd>, right hand <kbd>Y</kbd> <kbd>U</kbd> <kbd>I</kbd> <kbd>O</kbd> <kbd>P</kbd></li>
					<li>In each row the keys are: Shoot, Reload, Shield, Mirror, Double.</li>
					<li><b>Double:</b> hold the Double key, then press Shoot or Shield to use both hands.</li>
					<li><b>Shoot</b> needs ammo (1 in that hand; a double Shoot needs 3 in each hand). <b>Reload</b> adds 1 ammo (max 3).</li>
					<li><b>Shield</b> blocks a Shoot, but only every other turn. <b>Mirror</b> reflects a Shoot back at the shooter.</li>
					<li>A double Shoot beats a single Shield and Mirror. Only a double Shield stops it.</li>
					<li>Local games are timed: you get 10 seconds per turn. If time runs out you make no move that turn, which leaves you open to a Shoot.</li>
						<li>If both players Shoot, the shots cancel. Get shot and you lose.</li>
				</ul>
					<button type="button" id="help-close">Close</button>
				</div>
			</div>
			<div class="actions">
				<button type="button" id="play-again" data-goto="game" hidden>Play again</button>
				<button type="button" id="help-open">How to play</button>
				<button type="button" data-goto="menu">Quit to menu</button>
			</div>
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
			const count = bullets[player][hand];
			if (el) el.textContent = '●'.repeat(count) + '○'.repeat(Math.max(0, 3 - count));
		}
	}
}

// Turn state: each player locks in one move; both are revealed together.
let currentScreen = 'menu';
let turn = { p1: null, p2: null };
let revealing = false;
let revealTimer = null;
let gameOver = false;
let gameMode = 'local'; // set from the screen the game was started from
let turnNumber = 0;
const TURN_SECONDS = 10;
let timerId = null;
let turnEndsAt = 0;
let lastSecond = TURN_SECONDS;
let pausedLeft = null; // ms left on the clock while the help pop-up is open
let countdownTimer = null;
let bannerTimer = null;
let nextTurnTimer = null;
let audioCtx = null;
const shieldedLastTurn = { p1: false, p2: false }; // Shield is usable once every two turns
const MAX_AMMO = 3;
const REVEAL_SECONDS = 3; // how long the results stay up (keep in sync with app.py)

function setStatus(text) {
	const el = document.getElementById('game-status');
	if (el) el.textContent = text;
}

// Tiny beep for ticks, lock-ins and turn starts. Silently does nothing if audio isn't available.
function beep(freq = 660, dur = 0.08) {
	try {
		audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
		const osc = audioCtx.createOscillator();
		const gain = audioCtx.createGain();
		osc.frequency.value = freq;
		gain.gain.value = 0.04;
		osc.connect(gain);
		gain.connect(audioCtx.destination);
		osc.start();
		osc.stop(audioCtx.currentTime + dur);
	} catch (e) {
		// ignore
	}
}

function showBanner(text, ms) {
	const el = document.getElementById('banner');
	if (!el) return;
	clearTimeout(bannerTimer);
	el.textContent = text;
	el.classList.remove('show');
	void el.offsetWidth; // restart the pop animation
	el.classList.add('show');
	if (ms > 0) bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function setReady(player, text) {
	const el = document.getElementById(`${player}-ready`);
	if (!el) return;
	el.textContent = text;
	el.classList.toggle('locked', text !== 'Choosing...');
}

// Result tag under a player's move: kind is 'good', 'bad' or 'neutral'.
function setResult(player, text, kind) {
	const el = document.getElementById(`${player}-result`);
	if (!el) return;
	el.textContent = text;
	el.className = text ? `result ${kind}` : 'result';
}

// "Next turn in 3... 2... 1..." under the moves, so it's clear the turn is over.
function startNextTurnCountdown(baseText, seconds) {
	clearInterval(nextTurnTimer);
	let n = seconds;
	setStatus(`${baseText} | Next turn in ${n}...`);
	nextTurnTimer = setInterval(() => {
		n--;
		if (n <= 0) {
			clearInterval(nextTurnTimer);
			return;
		}
		setStatus(`${baseText} | Next turn in ${n}...`);
	}, 1000);
}

function updateHud() {
	const label = document.getElementById('turn-label');
	if (label) label.textContent = `Turn ${Math.max(1, turnNumber)}`;
	const hud = document.getElementById('hud');
	if (hud) hud.classList.toggle('no-timer', gameMode !== 'local');
}

function markWinner(winner) {
	for (const p of ['p1', 'p2']) {
		const el = document.getElementById(p === 'p1' ? 'player1' : 'player2');
		if (el) el.classList.add(p === winner ? 'winner' : 'loser');
	}
}

function clearWinnerMarks() {
	for (const id of ['player1', 'player2']) {
		const el = document.getElementById(id);
		if (el) el.classList.remove('winner', 'loser');
	}
}

function drawTimer(msLeft) {
	const fill = document.getElementById('timer-fill');
	const text = document.getElementById('timer-text');
	const hud = document.getElementById('hud');
	const secs = Math.ceil(msLeft / 1000);
	if (fill) fill.style.width = `${(msLeft / (TURN_SECONDS * 1000)) * 100}%`;
	if (text) text.textContent = secs;
	if (hud) hud.classList.toggle('urgent', msLeft > 0 && msLeft <= 3000);
	return secs;
}

function stopTimer() {
	clearInterval(timerId);
	timerId = null;
}

function startTurnTimer(ms = TURN_SECONDS * 1000) {
	stopTimer();
	pausedLeft = null;
	turnEndsAt = Date.now() + ms;
	lastSecond = drawTimer(ms);
	timerId = setInterval(() => {
		const left = Math.max(0, turnEndsAt - Date.now());
		const secs = drawTimer(left);
		if (secs !== lastSecond) {
			lastSecond = secs;
			if (secs > 0 && secs <= 3) beep(660, 0.08);
		}
		if (left === 0) timeUp();
	}, 100);
}

// The clock stops while the "How to play" pop-up is open.
function pauseTimer() {
	if (!timerId) return;
	pausedLeft = Math.max(0, turnEndsAt - Date.now());
	stopTimer();
}

function resumeTimer() {
	if (pausedLeft === null) return;
	const left = pausedLeft;
	pausedLeft = null;
	if (!revealing && !gameOver) startTurnTimer(left);
}

// Anyone who hasn't picked a move when time runs out makes no move this turn.
function timeUp() {
	stopTimer();
	for (const p of ['p1', 'p2']) {
		if (!turn[p]) turn[p] = { action: 'idle', hand: 'none' };
	}
	revealMoves();
}

// 3... 2... 1... before the first turn. Input is blocked meanwhile.
function startCountdown(done) {
	revealing = true;
	updateHud();
	setStatus('Get ready...');
	let n = 3;
	const step = () => {
		if (n === 0) {
			done();
			return;
		}
		showBanner(String(n), 800);
		beep(440, 0.12);
		n--;
		countdownTimer = setTimeout(step, 800);
	};
	step();
}

function resetTurn() {
	turn = { p1: null, p2: null };
	revealing = false;
	turnNumber++;
	clearWinnerMarks();
	clearInterval(nextTurnTimer);
	setResult('p1', '');
	setResult('p2', '');
	setReady('p1', 'Choosing...');
	setReady('p2', 'Choosing...');
	updateHud();
	if (gameMode === 'local') {
		setStatus('Choose your move!');
		showBanner(turnNumber === 1 ? 'GO!' : `Turn ${turnNumber}`, 700);
		beep(880, 0.1);
		if (isHelpOpen()) pausedLeft = TURN_SECONDS * 1000;
		else startTurnTimer();
	} else {
		setStatus('Choose your move!');
	}
}

function showScreen(name) {
	if (!screens[name]) return;
	screenEl.innerHTML = screens[name];
	if (name === 'game' && (currentScreen === 'local' || currentScreen === 'online')) gameMode = currentScreen;
	currentScreen = name;
	clearTimeout(revealTimer);
	clearTimeout(countdownTimer);
	clearInterval(nextTurnTimer);
	clearTimeout(bannerTimer);
	stopTimer();
	pausedLeft = null;
	if (name === 'game') {
		for (const p of ['p1', 'p2']) {
			bullets[p].left = 0;
			bullets[p].right = 0;
			shieldedLastTurn[p] = false;
		}
		gameOver = false;
		turnNumber = 0;
		if (gameMode === 'local') startCountdown(resetTurn);
		else resetTurn();
		renderBullets();
		renderKeyLegend();
	}
	// Keep the socket only while in an online game; any other screen closes it.
	if (!(name === 'game' && gameMode === 'online')) closeSocket();
}

// --- Online play (WebSocket; the server decides all results) ---
let ws = null;
let myPlayer = null; // 'p1' (created the game) or 'p2' (joined it)

function setOnlineStatus(text) {
	const el = document.getElementById('online-status');
	if (el) el.textContent = text;
}

function send(msg) {
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function closeSocket() {
	if (ws) {
		ws.onclose = null; // we closed it on purpose, no "connection lost" message
		ws.close();
	}
	ws = null;
	myPlayer = null;
}

function openSocket(firstMessage) {
	closeSocket();
	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	ws = new WebSocket(`${proto}://${location.host}/ws`);
	ws.onopen = () => send(firstMessage);
	ws.onmessage = (e) => handleServer(JSON.parse(e.data));
	ws.onclose = () => {
		ws = null;
		if (currentScreen === 'online') {
			setOnlineStatus('Could not connect, or the connection dropped. Try again.');
		} else if (currentScreen === 'game' && gameMode === 'online') {
			gameOver = true;
			clearTimeout(revealTimer);
			setStatus('Connection lost.');
		}
	};
}

function handleServer(msg) {
	switch (msg.type) {
		case 'created':
			setOnlineStatus(`Your game code is ${msg.code}. Waiting for a friend to join...`);
			break;
		case 'start': // first game, or a rematch
			myPlayer = msg.you;
			showScreen('game');
			for (const p of ['p1', 'p2']) {
				const h3 = document.querySelector(`#${p === 'p1' ? 'player1' : 'player2'} h3`);
				if (h3) h3.textContent = `Player ${p[1]}${p === myPlayer ? ' (you)' : ''}`;
			}
			break;
		case 'locked': // opponent picked (their move stays hidden)
			setReady(msg.player, 'READY');
			if (!turn[myPlayer]) setStatus('Opponent is ready. Choose your move!');
			break;
		case 'reveal':
			turn = msg.moves;
			revealMoves();
			// The server is the source of truth for ammo and shield recharge.
			for (const p of ['p1', 'p2']) Object.assign(bullets[p], msg.bullets[p]);
			Object.assign(shieldedLastTurn, msg.shielded);
			renderBullets();
			break;
		case 'next_turn':
			if (!gameOver) resetTurn();
			break;
		case 'rematch_requested':
			setStatus('Your opponent wants a rematch. Press "Play again" to accept.');
			break;
		case 'opponent_left':
			gameOver = true;
			clearTimeout(revealTimer);
			const again = document.getElementById('play-again');
			if (again) again.hidden = true;
			setStatus('Your opponent left the game.');
			break;
		case 'error':
			if (msg.kind === 'move' && myPlayer) { // server refused our move: unlock and let us pick again
				turn[myPlayer] = null;
				setReady(myPlayer, 'Choosing...');
				setStatus(`${msg.message} Pick another move.`);
			} else if (currentScreen === 'online') {
				setOnlineStatus(msg.message);
				closeSocket();
			}
			break;
	}
}

document.addEventListener('click', (event) => {
	if (event.target.closest('#create-game')) {
		setOnlineStatus('Connecting...');
		openSocket({ type: 'create' });
	} else if (event.target.closest('#join-game')) {
		const code = document.getElementById('join-code').value.trim().toUpperCase();
		if (!code) {
			setOnlineStatus('Enter a game code first.');
			return;
		}
		setOnlineStatus('Connecting...');
		openSocket({ type: 'join', code });
	}
});

document.addEventListener('click', (event) => {
	const target = event.target.closest('[data-goto]');
	if (target) {
		if (target.id === 'play-again' && gameMode === 'online') {
			send({ type: 'rematch' }); // both players must accept
			target.hidden = true;
			setStatus('Waiting for your opponent to accept the rematch...');
			return;
		}
		showScreen(target.dataset.goto);
	}
});

showScreen('menu');

// --- Key bindings (one keyboard, two players) ---
// Order in each row: shoot, reload, shield, mirror, double
const ACTIONS = ['shoot', 'reload', 'shield', 'mirror', 'double'];
const KEY_ROWS = {
	p1: { left: '12345', right: 'qwert' },
	p2: { left: '67890', right: 'yuiop' },
};
const keyMap = {};
const doubleKeys = { p1: [], p2: [] };
for (const player in KEY_ROWS) {
	for (const hand in KEY_ROWS[player]) {
		[...KEY_ROWS[player][hand]].forEach((key, i) => {
			keyMap[key] = { player, hand, action: ACTIONS[i] };
			if (ACTIONS[i] === 'double') doubleKeys[player].push(key);
		});
	}
}

// Display only: shows which key does which move. These are not clickable.
const KEY_LABELS = ['Shoot', 'Reload', 'Shield', 'Mirror', 'Double (hold)'];

function renderKeyLegend() {
	for (const player in KEY_ROWS) {
		for (const hand in KEY_ROWS[player]) {
			const el = document.getElementById(`${player}-${hand}-keys`);
			if (!el) continue;
			if (gameMode === 'online' && player !== myPlayer) {
				el.innerHTML = '';
				continue;
			}
			el.innerHTML = [...KEY_ROWS[player][hand]]
				.map((k, i) => `<span class="key"><kbd>${k.toUpperCase()}</kbd>${KEY_LABELS[i]}</span>`)
				.join('');
		}
	}
}

const heldKeys = new Set();

function isHelpOpen() {
	const help = document.getElementById('help');
	return !!help && !help.hidden;
}

function setHelp(open) {
	const help = document.getElementById('help');
	if (!help || help.hidden === !open) return;
	help.hidden = !open;
	if (open) pauseTimer();
	else resumeTimer();
}

document.addEventListener('click', (event) => {
	if (event.target.closest('#help-open')) setHelp(true);
	else if (event.target.closest('#help-close') || event.target.id === 'help') setHelp(false);
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') setHelp(false);
});

function describeMove(move) {
	if (move.action === 'idle') return 'No move';
	const name = move.action.charAt(0).toUpperCase() + move.action.slice(1);
	return move.hand === 'both' ? `Double ${name}` : `${name} (${move.hand} hand)`;
}

// Returns an error message if the move isn't allowed, otherwise null.
function checkMove(player, move) {
	const hands = move.hand === 'both' ? ['left', 'right'] : [move.hand];
	if (move.action === 'shoot') {
		const need = move.hand === 'both' ? 3 : 1;
		if (hands.some((h) => bullets[player][h] < need)) return 'Not enough ammo for that shot.';
	}
	if (move.action === 'shield' && shieldedLastTurn[player]) return 'Shield needs a turn to recharge.';
	return null;
}

// What happens to one shot against the other player's move.
// Assumption: a double Shoot beats a single Shield and a Mirror; only a double Shield stops it.
function shotOutcome(shot, defense) {
	const isDouble = shot.hand === 'both';
	if (defense.action === 'shoot') return 'cancel';
	if (defense.action === 'shield') return isDouble && defense.hand !== 'both' ? 'hit' : 'blocked';
	if (defense.action === 'mirror') return isDouble ? 'hit' : 'reflected';
	return 'hit'; // Reload (or anything else) doesn't protect you
}

function applyMoves() {
	for (const p of ['p1', 'p2']) {
		const m = turn[p];
		if (m.action === 'reload') bullets[p][m.hand] = Math.min(MAX_AMMO, bullets[p][m.hand] + 1);
		if (m.action === 'shoot') {
			const cost = m.hand === 'both' ? 3 : 1;
			(m.hand === 'both' ? ['left', 'right'] : [m.hand]).forEach((h) => (bullets[p][h] -= cost));
		}
		shieldedLastTurn[p] = m.action === 'shield';
	}
}

function revealMoves() {
	stopTimer();
	revealing = true;
	let text = `Player 1: ${describeMove(turn.p1)} | Player 2: ${describeMove(turn.p2)}`;
	let winner = null;
	let headline = 'No hits this turn';
	setResult('p1', '');
	setResult('p2', '');
	for (const [s, t] of [['p1', 'p2'], ['p2', 'p1']]) {
		if (turn[s].action !== 'shoot') continue;
		const result = shotOutcome(turn[s], turn[t]);
		if (result === 'hit') {
			winner = s;
			headline = `Player ${t[1]} got shot!`;
			setResult(t, 'Got shot!', 'bad');
			setResult(s, 'Direct hit!', 'good');
		} else if (result === 'reflected') {
			winner = t;
			headline = `Reflected! Player ${s[1]} got shot!`;
			setResult(s, 'Shot reflected back at you!', 'bad');
			setResult(t, 'Reflected the shot!', 'good');
		} else if (result === 'blocked') {
			text += ` | Player ${t[1]} blocked the shot`;
			headline = `Player ${t[1]} blocked the shot!`;
			setResult(t, 'Blocked the shot!', 'good');
			setResult(s, 'Your shot was blocked', 'neutral');
		} else if (result === 'cancel') {
			if (s === 'p1') text += ' | Shots cancelled out';
			headline = 'Shots cancelled out!';
			setResult('p1', 'Shots cancelled out', 'neutral');
			setResult('p2', 'Shots cancelled out', 'neutral');
		}
	}
	const turnLabel = document.getElementById('turn-label');
	applyMoves();
	renderBullets();
	setReady('p1', describeMove(turn.p1));
	setReady('p2', describeMove(turn.p2));
	if (winner) {
		gameOver = true;
		markWinner(winner);
		if (turnLabel) turnLabel.textContent = 'Game over';
		showBanner(`Player ${winner[1]} wins!`, 2500);
		beep(330, 0.3);
		const again = document.getElementById('play-again');
		if (again) again.hidden = false;
		setStatus(`${text} | Player ${winner[1]} wins!`);
		return;
	}
	if (turnLabel) turnLabel.textContent = `Turn ${turnNumber} over`;
	showBanner(headline, 1500);
	beep(headline === 'No hits this turn' ? 520 : 400, 0.15);
	startNextTurnCountdown(text, REVEAL_SECONDS);
	if (gameMode !== 'online') revealTimer = setTimeout(resetTurn, REVEAL_SECONDS * 1000); // online: server sends next_turn
}

document.addEventListener('keydown', (event) => {
	if (event.repeat) return;
	const key = event.key.toLowerCase();
	heldKeys.add(key);
	if (currentScreen !== 'game' || revealing || gameOver || isHelpOpen()) return;

	const bind = keyMap[key];
	if (!bind || bind.action === 'double' || turn[bind.player]) return;
	if (gameMode === 'online' && bind.player !== myPlayer) return;

	// Holding a double key while pressing Shoot or Shield makes it a double move.
	const move = { action: bind.action, hand: bind.hand };
	const doubleHeld = doubleKeys[bind.player].some((k) => heldKeys.has(k));
	if (doubleHeld && (bind.action === 'shoot' || bind.action === 'shield')) {
		move.hand = 'both';
	}
	const n = bind.player === 'p1' ? 1 : 2;
	const problem = checkMove(bind.player, move);
	if (problem) {
		setStatus(`Player ${n}: ${problem} Pick another move.`);
		return;
	}
	turn[bind.player] = move;
	setReady(bind.player, 'READY'); // doesn't reveal the move
	beep(520, 0.06);

	if (gameMode === 'online') {
		send({ type: 'move', move });
		setStatus('Locked in. Waiting for your opponent...');
		return;
	}

	if (turn.p1 && turn.p2) {
		revealMoves();
	} else {
		setStatus(`Player ${n} is ready. Waiting for Player ${3 - n}...`);
	}
});

document.addEventListener('keyup', (event) => heldKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => heldKeys.clear());
