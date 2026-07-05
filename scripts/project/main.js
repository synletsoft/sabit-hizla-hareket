const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;
const DEFAULT_FRAME_COUNT = 241;

const SIMULATION_TIME_SCALE = 1;
const ROAD_SPEED_FACTOR = 18;
const CAR_SPEED_FACTOR = 7.4;
const MAX_ROAD_SPEED = 680;
const MAX_CAR_SPEED = 235;
const STARTING_ROAD_VISUAL_SPEED = 0.75;
const STARTING_CAR_VISUAL_SPEED = 1.1;
const CAR_ACCELERATION_VISUAL_BOOST = 1.35;
const MAX_ROAD_FRAME_STEP = 14;
const MAX_CAR_FRAME_STEP = 5.5;
const SLIDER_KNOB_EDGE_INSET = 8;
const MAX_DURATION = 30;
const MAX_INITIAL_SPEED = 20;
const MAX_ACCELERATION = 5;
const VELOCITY_SCALE_MAX = MAX_INITIAL_SPEED + MAX_ACCELERATION * MAX_DURATION;
const POSITION_SCALE_MAX = MAX_INITIAL_SPEED * MAX_DURATION + 0.5 * MAX_ACCELERATION * MAX_DURATION * MAX_DURATION;
const ACCELERATION_AXIS_MAX = 6;
const VELOCITY_AXIS_MAX = 180;
const POSITION_AXIS_MAX = 3000;
const FRAME_MIN = 0;
const FRAME_MAX = 240;
const FRAME_COUNT = FRAME_MAX - FRAME_MIN + 1;

const GRAPH_CONFIGS = [
	{ key: "a", title: "İvme - Zaman (a-t)", axis: "İvme (m/s²)", color: "#13b778", fill: "rgba(57, 219, 165, 0.18)", accessor: point => point.a, areaLabel: "Hız Değişimini verir.", range: { min: -ACCELERATION_AXIS_MAX, max: ACCELERATION_AXIS_MAX } },
	{ key: "v", title: "Hız - Zaman (v-t)", axis: "Hız (m/s)", color: "#0098e5", fill: "rgba(89, 199, 245, 0.20)", accessor: point => point.v, areaLabel: "Yer Değiştirmeyi verir.", range: { min: -VELOCITY_AXIS_MAX, max: VELOCITY_AXIS_MAX } },
	{ key: "x", title: "Konum - Zaman (x-t)", axis: "Konum (m)", color: "#5347ff", fill: "rgba(111, 101, 255, 0.16)", accessor: point => point.x, areaLabel: "", range: { min: -POSITION_AXIS_MAX, max: POSITION_AXIS_MAX } }
];

runOnStartup(runtime =>
{
	const simulation = new MotionSimulation(runtime);

	runtime.addEventListener("afteranylayoutstart", e =>
	{
		if (e.layout.name === "game")
			simulation.mount();
		else
			simulation.unmount();
	});

	runtime.addEventListener("tick", () =>
	{
		simulation.update(runtime.dt || 0);
	});
});

class MotionSimulation
{
	constructor(runtime)
	{
		this.runtime = runtime;
		this.host = null;
		this.canvases = {};
		this.contexts = {};
		this.controls = {};
		this.outputs = {};
		this.duration = 10;
		this.x0 = 0;
		this.v0 = 3;
		this.a = 2;
		this.t = 0;
		this.x = 0;
		this.v = 3;
		this.visualV = 3;
		this.hasStoppedByDeceleration = false;
		this.isRunning = false;
		this.isPaused = false;
		this.hasFinished = false;
		this.data = [];
		this.roadFrame = 0;
		this.carFrame = 0;
		this.roadFrameCount = FRAME_COUNT;
		this.carFrameCount = FRAME_COUNT;
		this.lastDrawTime = -1;
		this.objects = {};
		this.panelTimers = [];
	}

	mount()
	{
		this.unmount();
		injectStyles();
		this.bindConstructObjects();
		this.hideOriginalUi();
		this.createInterface();
		this.resetState();
		this.stopNativeAnimations();
		this.updateAll();
		this.scheduleIntroPanels();
	}

	unmount()
	{
		if (this.host)
		{
			this.host.remove();
			this.host = null;
		}

		this.canvases = {};
		this.contexts = {};
		this.controls = {};
		this.outputs = {};
		this.clearPanelTimers();
		window.removeEventListener("resize", MotionSimulation.resizeHost);
		window.removeEventListener("orientationchange", MotionSimulation.resizeHost);
		window.visualViewport?.removeEventListener("resize", MotionSimulation.resizeHost);
		window.visualViewport?.removeEventListener("scroll", MotionSimulation.resizeHost);
		this.showOriginalUi();
	}

	bindConstructObjects()
	{
		this.objects.resultText = getFirst(this.runtime, "resultText");
		this.objects.resultBox = getFirst(this.runtime, "netinkutusu");
		this.objects.road = getFirst(this.runtime, "yol");
		this.objects.car = getFirst(this.runtime, "arac");
		this.objects.shadow = getFirst(this.runtime, "araçgölge") || getFirst(this.runtime, "araÃ§gÃ¶lge");
		this.objects.refresh = getFirst(this.runtime, "refreshBtn");
		this.objects.audio = getFirst(this.runtime, "audioBtn");
		this.objects.share = getFirst(this.runtime, "shareBtn");
		this.objects.fullscreen = getFirst(this.runtime, "fullScreenBtn");

		this.roadFrameCount = FRAME_COUNT;
		this.carFrameCount = FRAME_COUNT;
	}

	hideOriginalUi()
	{
		for (const item of [this.objects.resultText, this.objects.resultBox])
			setInstanceVisible(item, false);
	}

	showOriginalUi()
	{
		for (const item of [this.objects.resultText, this.objects.resultBox, this.objects.refresh, this.objects.audio, this.objects.share, this.objects.fullscreen])
			setInstanceVisible(item, true);
	}

	createInterface()
	{
		const host = document.createElement("div");
		host.id = "motion-sim-host";
		host.innerHTML = `
			<section class="left-graph-rail" aria-label="Hareket grafikleri">
				${GRAPH_CONFIGS.map(graph => `
					<article class="graph-card graph-${graph.key}">
						<h2>${graph.title}</h2>
						<div class="graph-area-label" data-area="${graph.key}"></div>
						<canvas data-graph="${graph.key}" width="235" height="236"></canvas>
					</article>
				`).join("")}
			</section>
			<button class="rail-toggle left-toggle" type="button" data-toggle-panel="graphs" aria-label="Grafikleri kapat">‹</button>

			<nav class="top-tabs" aria-label="Grafik sekmeleri">
				<button type="button" data-focus-graph="x" aria-label="Konum grafiği">
					<span class="tab-title">Konum(x)</span>
					<output class="tab-value" data-output="readoutX">0.00 m</output>
				</button>
				<button type="button" data-focus-graph="v" aria-label="Hız grafiği">
					<span class="tab-title">Hız(v)</span>
					<output class="tab-value" data-output="readoutV">3.00 m/s</output>
				</button>
				<button type="button" data-focus-graph="a" aria-label="İvme grafiği">
					<span class="tab-title">İvme(a)</span>
					<output class="tab-value" data-output="readoutA">2.00 m/s²</output>
				</button>
			</nav>

			<aside class="parameter-panel" aria-label="Simülasyon ayarları">
				<button class="rail-toggle right-toggle" type="button" data-toggle-panel="params" aria-label="Ayarları kapat">›</button>
				<div class="panel-buttons">
					<button class="start-button" type="button" data-action="start"><span>▷</span>Başlat</button>
					<button class="reset-button" type="button" data-action="reset"><span>↻</span>Sıfırla</button>
				</div>
				<div class="parameter-values">
					<output data-output="duration">10 s</output>
					<output data-output="v0">3.0 m/s</output>
					<output data-output="a">2.0 m/s²</output>
				</div>
				<div class="slider-grid">
					${this.createSliderTemplate("duration", "Süre", "(t)", "1", "30", "1")}
					${this.createSliderTemplate("v0", "İlk Hız", "(V₀)", "-20", "20", "0.1")}
					${this.createSliderTemplate("a", "İvme", "(a)", "-5", "5", "0.1")}
				</div>
			</aside>

			<section class="bottom-scale" aria-label="Konum skalası">
				<div class="scale-ticks">${Array.from({ length: 61 }, (_, index) => `<i class="${index % 5 === 0 ? "is-major" : ""}"></i>`).join("")}</div>
				<div class="scale-marker"></div>
			</section>
		`;

		document.body.appendChild(host);
		this.host = host;

		for (const canvas of host.querySelectorAll("canvas"))
		{
			const key = canvas.dataset.graph;
			this.canvases[key] = canvas;
			this.contexts[key] = canvas.getContext("2d");
		}

		for (const output of host.querySelectorAll("[data-output]"))
			this.outputs[output.dataset.output] = output;

		for (const input of host.querySelectorAll("input[type='range']"))
		{
			this.controls[input.dataset.param] = input;
			input.addEventListener("input", () => this.handleParamInput(input.dataset.param, Number(input.value)));
		}

		host.querySelector("[data-action='start']").addEventListener("click", () => this.handlePrimaryAction());
		host.querySelector("[data-action='reset']").addEventListener("click", () => this.reset());
		host.querySelector("[data-toggle-panel='graphs']").addEventListener("click", () => this.togglePanel("graphs"));
		host.querySelector("[data-toggle-panel='params']").addEventListener("click", () => this.togglePanel("params"));

		for (const button of host.querySelectorAll("[data-focus-graph]"))
			button.addEventListener("click", () => this.flashGraph(button.dataset.focusGraph));

		MotionSimulation.resizeHost = () => resizeStage(host);
		window.addEventListener("resize", MotionSimulation.resizeHost);
		window.addEventListener("orientationchange", MotionSimulation.resizeHost);
		window.visualViewport?.addEventListener("resize", MotionSimulation.resizeHost);
		window.visualViewport?.addEventListener("scroll", MotionSimulation.resizeHost);
		resizeStage(host);
	}

	createSliderTemplate(param, label, unit, min, max, step)
	{
		return `
			<label class="vertical-control">
				<div class="visual-slider" aria-hidden="true">
					<div class="visual-knob" data-knob="${param}"></div>
				</div>
				<input type="range" min="${min}" max="${max}" step="${step}" data-param="${param}" aria-label="${label}">
				<span>${label}<strong>${unit}</strong></span>
			</label>
		`;
	}

	handleParamInput(param, value)
	{
		if (param === "duration")
			this.duration = clamp(Math.round(value), 1, 30);
		else if (param === "v0")
			this.v0 = clamp(value, -20, 20);
		else if (param === "a")
			this.a = clamp(value, -5, 5);

		this.reset(false);
		this.updateControls();
	}

	handlePrimaryAction()
	{
		if (this.isRunning)
		{
			this.pause();
			return;
		}

		this.start();
	}

	start()
	{
		if (this.isRunning)
			return;

		if (this.hasFinished || this.t >= this.duration)
			this.reset(false);

		this.isRunning = true;
		this.isPaused = false;
		this.hasFinished = false;
		this.updateButtons();
		this.scheduleRunPanels();
	}

	pause()
	{
		if (!this.isRunning)
			return;

		this.isRunning = false;
		this.isPaused = true;
		this.clearPanelTimers();
		this.updateButtons();
	}

	reset(updateUi = true)
	{
		this.resetState();
		this.stopNativeAnimations();

		if (updateUi)
			this.updateControls();

		this.updateAll();
	}

	resetState()
	{
		this.t = 0;
		this.x = this.x0;
		this.v = this.v0;
		this.visualV = this.v0;
		this.hasStoppedByDeceleration = false;
		this.isRunning = false;
		this.isPaused = false;
		this.hasFinished = false;
		this.data = [{ t: 0, x: this.x, v: this.v, a: this.a }];
		this.lastDrawTime = -1;
		this.roadFrame = 0;
		this.carFrame = 0;
	}

	update(dt)
	{
		if (!this.host)
			return;

		if (this.isRunning)
		{
			this.t = Math.min(this.duration, this.t + Math.max(0, dt) * SIMULATION_TIME_SCALE);
			this.updatePhysics();
			this.data.push({ t: this.t, x: this.x, v: this.v, a: this.a });

			if (this.t >= this.duration)
			{
				this.isRunning = false;
				this.hasFinished = true;
			}
		}

		this.updateAnimations(dt);
		this.updateScaleMarker();
		this.updateLiveReadouts();

		if (this.isRunning || this.hasFinished || this.lastDrawTime !== this.t)
			this.drawGraphs();

		this.updateButtons();
	}

	updatePhysics()
	{
		const stopTime = getDecelerationStopTime(this.v0, this.a);
		const physicsTime = stopTime === null ? this.t : Math.min(this.t, stopTime);

		this.x = this.x0 + this.v0 * physicsTime + 0.5 * this.a * physicsTime * physicsTime;
		this.v = stopTime !== null && this.t >= stopTime
			? 0
			: this.v0 + this.a * this.t;
		this.visualV = stopTime !== null && this.t >= stopTime
			? 0
			: this.v;
		this.hasStoppedByDeceleration = stopTime !== null && this.t >= stopTime;
	}

	updateAnimations(dt)
	{
		const absV = Math.abs(this.visualV);
		const direction = Math.sign(this.visualV) || Math.sign(this.a) || 1;
		const hasPhysicalMotion = !this.hasStoppedByDeceleration && (absV > 0.05 || Math.abs(this.a) > 0.05);
		const startsFromRest = Math.abs(this.v0) < 0.05;
		const startupRoadSpeed = startsFromRest ? STARTING_ROAD_VISUAL_SPEED : 0;
		const startupCarSpeed = startsFromRest
			? Math.max(STARTING_CAR_VISUAL_SPEED, Math.abs(this.a) * CAR_ACCELERATION_VISUAL_BOOST)
			: 0;
		const roadVisualSpeed = this.isRunning && hasPhysicalMotion ? Math.max(absV, startupRoadSpeed) : 0;
		const carVisualSpeed = this.isRunning && hasPhysicalMotion ? Math.max(absV, startupCarSpeed) : 0;
		let roadSpeed = clamp(roadVisualSpeed * ROAD_SPEED_FACTOR, 0, MAX_ROAD_SPEED);
		let carSpeed = clamp(carVisualSpeed * CAR_SPEED_FACTOR, 0, MAX_CAR_SPEED);

		if (!this.isRunning || !hasPhysicalMotion)
		{
			roadSpeed = 0;
			carSpeed = 0;
		}

		const roadStep = Math.min(roadSpeed * dt, MAX_ROAD_FRAME_STEP);
		const carStep = Math.min(carSpeed * dt, MAX_CAR_FRAME_STEP);
		this.roadFrame = wrap(this.roadFrame - direction * roadStep, 0, this.roadFrameCount);
		this.carFrame = wrap(this.carFrame - direction * carStep, 0, this.carFrameCount);

		setSpriteFrame(this.objects.road, Math.floor(this.roadFrame));
		setSpriteFrame(this.objects.car, Math.floor(this.carFrame));
		setSpriteAnimationSpeed(this.objects.road, 0);
		setSpriteAnimationSpeed(this.objects.car, 0);
	}

	stopNativeAnimations()
	{
		setSpriteAnimationSpeed(this.objects.road, 0);
		setSpriteAnimationSpeed(this.objects.car, 0);

		if (this.objects.road && typeof this.objects.road.stopAnimation === "function")
			this.objects.road.stopAnimation();
		if (this.objects.car && typeof this.objects.car.stopAnimation === "function")
			this.objects.car.stopAnimation();
	}

	updateAll()
	{
		this.updateControls();
		this.updateLiveReadouts();
		this.updateAnimations(0);
		this.updateScaleMarker();
		this.drawGraphs();
		this.updateButtons();
	}

	updateControls()
	{
		this.setControlValue("duration", this.duration, "s", 0);
		this.setControlValue("v0", this.v0, "m/s", 1);
		this.setControlValue("a", this.a, "m/s²", 1);
	}

	setControlValue(param, value, unit, digits)
	{
		const input = this.controls[param];
		const output = this.outputs[param];

		if (input)
		{
			input.value = String(value);
			this.updateKnob(input, value);
		}
		if (output)
			output.textContent = `${Number(value).toFixed(digits)} ${unit}`;
	}

	updateLiveReadouts()
	{
		if (this.outputs.readoutX)
			this.outputs.readoutX.textContent = `${trimNumber(this.x)} m`;
		if (this.outputs.readoutV)
			this.outputs.readoutV.textContent = `${trimNumber(this.v)} m/s`;
		if (this.outputs.readoutA)
			this.outputs.readoutA.textContent = `${trimNumber(this.a)} m/s²`;
	}

	updateKnob(input, value)
	{
		const knob = this.host?.querySelector(`[data-knob='${input.dataset.param}']`);
		if (!knob)
			return;

		const min = Number(input.min);
		const max = Number(input.max);
		const normalized = clamp((value - min) / (max - min), 0, 1);
		knob.style.bottom = `${SLIDER_KNOB_EDGE_INSET + normalized * (100 - SLIDER_KNOB_EDGE_INSET * 2)}%`;
	}

	updateButtons()
	{
		const button = this.host?.querySelector("[data-action='start']");
		if (!button)
			return;

		button.classList.toggle("is-running", this.isRunning);
		button.classList.toggle("is-paused", this.isPaused);
		if (this.isRunning)
			button.innerHTML = "<span>Ⅱ</span>Durdur";
		else if (this.isPaused)
			button.innerHTML = "<span>▷</span>Devam Et";
		else
			button.innerHTML = "<span>▷</span>Başlat";
	}

	updateScaleMarker()
	{
		if (!this.host)
			return;

		const marker = this.host.querySelector(".scale-marker");
		if (!marker)
			return;

		const normalized = clamp(0.5 + this.x / (POSITION_SCALE_MAX * 2), 0.02, 0.98);
		marker.style.left = `${normalized * 100}%`;
	}

	flashGraph(key)
	{
		const card = this.host?.querySelector(`.graph-${key}`);
		if (!card)
			return;

		card.classList.remove("is-focused");
		void card.offsetWidth;
		card.classList.add("is-focused");
	}

	scheduleIntroPanels()
	{
		this.clearPanelTimers();
		this.setPanelCollapsed("graphs", false);
		this.panelTimers.push(window.setTimeout(() =>
		{
			this.setPanelCollapsed("graphs", true);
		}, 1000));
	}

	scheduleRunPanels()
	{
		this.clearPanelTimers();
		this.panelTimers.push(window.setTimeout(() =>
		{
			this.setPanelCollapsed("params", true);
			this.setPanelCollapsed("graphs", false);
		}, 1000));
	}

	clearPanelTimers()
	{
		for (const timer of this.panelTimers)
			window.clearTimeout(timer);
		this.panelTimers = [];
	}

	togglePanel(name)
	{
		if (!this.host)
			return;

		this.clearPanelTimers();
		const className = name === "graphs" ? "graphs-collapsed" : "params-collapsed";
		this.setPanelCollapsed(name, !this.host.classList.contains(className));
	}

	setPanelCollapsed(name, collapsed)
	{
		if (!this.host)
			return;

		const className = name === "graphs" ? "graphs-collapsed" : "params-collapsed";
		this.host.classList.toggle(className, collapsed);
		this.updatePanelToggle(name);
	}

	updatePanelToggle(name)
	{
		const button = this.host?.querySelector(`[data-toggle-panel='${name}']`);
		if (!button)
			return;

		const className = name === "graphs" ? "graphs-collapsed" : "params-collapsed";
		const isCollapsed = this.host.classList.contains(className);
		button.textContent = name === "graphs"
			? isCollapsed ? "›" : "‹"
			: isCollapsed ? "‹" : "›";
		button.setAttribute("aria-label", name === "graphs"
			? isCollapsed ? "Grafikleri aç" : "Grafikleri kapat"
			: isCollapsed ? "Ayarları aç" : "Ayarları kapat");
	}

	drawGraphs()
	{
		this.lastDrawTime = this.t;

		for (const graph of GRAPH_CONFIGS)
			this.drawGraph(graph);
	}

	drawGraph(graph)
	{
		const canvas = this.canvases[graph.key];
		const ctx = this.contexts[graph.key];
		if (!canvas || !ctx)
			return;

		const width = canvas.width;
		const height = canvas.height;
		const padLeft = 38;
		const padRight = 10;
		const padTop = 18;
		const padBottom = 32;
		const plotW = width - padLeft - padRight;
		const plotH = height - padTop - padBottom;
		const domainMax = MAX_DURATION;
		const range = graph.range;

		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, width, height);

		const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
		gradient.addColorStop(0, graph.fill);
		gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

		ctx.strokeStyle = "rgba(176, 194, 211, 0.55)";
		ctx.setLineDash([3, 4]);
		ctx.lineWidth = 1;
		ctx.fillStyle = "#667085";
		ctx.font = "12px Calibri, Arial, sans-serif";
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";

		for (let i = 0; i <= 4; i++)
		{
			const x = padLeft + plotW * i / 4;
			const y = padTop + plotH * i / 4;
			ctx.beginPath();
			ctx.moveTo(x, padTop);
			ctx.lineTo(x, padTop + plotH);
			ctx.moveTo(padLeft, y);
			ctx.lineTo(padLeft + plotW, y);
			ctx.stroke();

			const yValue = range.max - (range.max - range.min) * i / 4;
			ctx.fillText(trimNumber(yValue), padLeft - 7, y);
		}

		ctx.setLineDash([]);
		ctx.strokeStyle = "#6b7280";
		ctx.lineWidth = 1.6;
		ctx.beginPath();
		ctx.moveTo(padLeft, padTop);
		ctx.lineTo(padLeft, padTop + plotH);
		ctx.lineTo(padLeft + plotW, padTop + plotH);
		ctx.stroke();

		ctx.fillStyle = "#6b7280";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.font = "12px Calibri, Arial, sans-serif";
		ctx.fillText("Zaman (s)", padLeft + plotW / 2, height - 20);

		ctx.save();
		ctx.translate(10, padTop + plotH / 2);
		ctx.rotate(-Math.PI / 2);
		ctx.fillText(graph.axis, 0, 0);
		ctx.restore();

		if (this.data.length > 1)
		{
			const points = this.data.map(point =>
			{
				const value = graph.accessor(point);
				return {
					x: padLeft + (point.t / domainMax) * plotW,
					y: padTop + (1 - (value - range.min) / (range.max - range.min)) * plotH
				};
			});

			ctx.beginPath();
			ctx.moveTo(points[0].x, padTop + plotH);
			for (const point of points)
				ctx.lineTo(point.x, point.y);
			ctx.lineTo(points[points.length - 1].x, padTop + plotH);
			ctx.closePath();
			ctx.fillStyle = gradient;
			ctx.fill();

			ctx.strokeStyle = graph.color;
			ctx.lineWidth = 3;
			ctx.lineJoin = "round";
			ctx.lineCap = "round";
			ctx.beginPath();
			points.forEach((point, index) =>
			{
				if (index === 0)
					ctx.moveTo(point.x, point.y);
				else
					ctx.lineTo(point.x, point.y);
			});
			ctx.stroke();

			ctx.fillStyle = graph.color;
			for (let i = 0; i < points.length; i += Math.max(1, Math.floor(points.length / 8)))
			{
				ctx.beginPath();
				ctx.arc(points[i].x, points[i].y, 2.4, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		const area = graph.key === "x" ? Math.abs(this.x) : Math.abs(areaEstimate(this.data, graph.accessor));
		const label = this.host?.querySelector(`[data-area='${graph.key}']`);
		if (label)
		{
			const unit = graph.key === "a" ? "m/s" : graph.key === "v" ? "m" : "m";
			label.textContent = graph.areaLabel
				? `Alan: ${trimNumber(area)} ${unit} (${graph.areaLabel})`
				: `Alan: ${trimNumber(area)} m`;
		}
	}
}

function getFirst(runtime, objectName)
{
	try
	{
		return runtime.objects[objectName]?.getFirstInstance() || null;
	}
	catch
	{
		return null;
	}
}

function setSpriteFrame(instance, frame)
{
	if (!instance)
		return;

	try
	{
		instance.animationFrame = frame;
	}
	catch
	{
		if (typeof instance.setAnimationFrame === "function")
			instance.setAnimationFrame(frame);
	}
}

function setSpriteAnimationSpeed(instance, speed)
{
	if (!instance)
		return;

	try
	{
		instance.animationSpeed = speed;
	}
	catch
	{
		// Some Construct releases expose manual frame control but not animationSpeed.
	}
}

function setInstanceVisible(instance, visible)
{
	if (!instance)
		return;

	try
	{
		instance.isVisible = visible;
	}
	catch
	{
		try
		{
			instance.opacity = visible ? 1 : 0;
		}
		catch
		{
			// Visibility APIs vary between Construct runtime releases.
		}
	}
}

function getAnimationFrameCount(instance, fallback)
{
	if (!instance)
		return fallback;

	const candidates = [
		instance.animationFrameCount,
		instance.frameCount,
		instance.animation?.frameCount,
		instance.animation?.frames?.length
	];

	for (const value of candidates)
	{
		if (Number.isFinite(value) && value > 0)
			return value;
	}

	return fallback;
}

function requestFullscreen()
{
	const element = document.documentElement;
	if (document.fullscreenElement)
		document.exitFullscreen?.();
	else
		element.requestFullscreen?.();
}

function resizeStage(host)
{
	applyResizeStage(host);
	window.requestAnimationFrame?.(() => applyResizeStage(host));
	for (const delay of [80, 180, 360])
		window.setTimeout(() => applyResizeStage(host), delay);
}

function applyResizeStage(host)
{
	if (!host || !document.body.contains(host))
		return;

	const canvas = Array.from(document.querySelectorAll("canvas"))
		.find(item => !host.contains(item));
	const rect = canvas?.getBoundingClientRect?.();

	if (rect && rect.width > 0 && rect.height > 0)
	{
		const scale = Math.min(rect.width / GAME_WIDTH, rect.height / GAME_HEIGHT);
		host.style.left = `${rect.left + rect.width / 2}px`;
		host.style.top = `${rect.top + rect.height / 2}px`;
		host.style.transform = `translate(-50%, -50%) scale(${scale})`;
		return;
	}

	const scale = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT);
	host.style.left = "50%";
	host.style.top = "50%";
	host.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function injectStyles()
{
	if (document.getElementById("motion-sim-styles"))
		return;

	const style = document.createElement("style");
	style.id = "motion-sim-styles";
	style.textContent = `
		#motion-sim-host {
			position: fixed;
			left: 50%;
			top: 50%;
			width: ${GAME_WIDTH}px;
			height: ${GAME_HEIGHT}px;
			transform-origin: center center;
			z-index: 30;
			pointer-events: none;
			font-family: Calibri, Arial, sans-serif;
			color: #1f2933;
			overflow: hidden;
		}

		.left-graph-rail {
			position: absolute;
			left: 0;
			top: 0;
			width: 381px;
			height: 1080px;
			box-sizing: border-box;
			padding: 8px 42px 8px 22px;
			display: grid;
			grid-template-rows: repeat(3, 1fr);
			gap: 0;
			background: rgba(245, 248, 251, 0.94) url("assets/Solbar.png") center / 100% 100% no-repeat;
			pointer-events: none;
			transition: transform 240ms ease;
		}

		#motion-sim-host.graphs-collapsed .left-graph-rail {
			transform: translateX(-381px);
		}

		.rail-toggle {
			position: absolute;
			z-index: 40;
			width: 46px;
			height: 92px;
			border: 0;
			border-radius: 0 22px 22px 0;
			background: rgba(223, 232, 241, 0.96);
			box-shadow: 0 5px 13px rgba(25, 34, 47, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.8);
			color: #0b7bd3;
			font: 900 48px/1 Calibri, Arial, sans-serif;
			cursor: pointer;
			pointer-events: auto;
		}

		.left-toggle {
			left: 381px;
			top: 488px;
			transition: left 240ms ease;
		}

		#motion-sim-host.graphs-collapsed .left-toggle {
			left: 0;
		}

		.graph-card {
			position: relative;
			box-sizing: border-box;
			width: 318px;
			height: 368px;
			padding: 18px 28px 18px 36px;
			border-radius: 12px;
			background: #ffffff;
			box-shadow: 0 1px 0 rgba(47, 63, 82, 0.14), inset 0 0 0 1px rgba(207, 216, 226, 0.9);
		}

		.graph-card.is-focused {
			animation: graphPulse 420ms ease;
		}

		.graph-card h2 {
			margin: 0;
			text-align: center;
			color: #17223a;
			font: 800 17px/1.25 Calibri, Arial, sans-serif;
			letter-spacing: 0;
		}

		.graph-area-label {
			height: 22px;
			margin-top: 9px;
			text-align: center;
			color: #028bb5;
			font: 800 12px/1.2 Calibri, Arial, sans-serif;
			white-space: nowrap;
		}

		.graph-card canvas {
			display: block;
			width: 235px;
			height: 236px;
			margin: 6px auto 0;
			background: #ffffff;
		}

		.top-tabs {
			position: absolute;
			z-index: 12;
			left: 622px;
			top: 30px;
			width: 675px;
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 0;
			pointer-events: auto;
		}

		.top-tabs button {
			width: 225px;
			height: 93px;
			border: 0;
			border-radius: 18px;
			background: linear-gradient(#eef2f6, #cdd5de);
			background-size: 100% 100%;
			background-position: center;
			background-repeat: no-repeat;
			box-shadow: 0 6px 16px rgba(34, 45, 60, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.78);
			color: #424242;
			font: 900 25px/1 Calibri, Arial, sans-serif;
			letter-spacing: 0;
			cursor: pointer;
			overflow: hidden;
			position: relative;
			z-index: 1;
			display: grid;
			place-items: center;
			align-content: center;
			gap: 6px;
		}

		.top-tabs .tab-title {
			display: block;
			font: 900 26px/1 Calibri, Arial, sans-serif;
		}

		.top-tabs .tab-value {
			display: block;
			color: #1e3347;
			font: 900 22px/1 Calibri, Arial, sans-serif;
			white-space: nowrap;
		}

		.top-tabs button:hover,
		.top-tabs button:focus-visible {
			filter: brightness(1.04);
			outline: 0;
		}

		.top-tabs button[data-focus-graph="x"] {
			background: linear-gradient(#eef2f6, #cdd5de);
		}

		.top-tabs button[data-focus-graph="v"] {
			background: linear-gradient(#eef2f6, #cdd5de);
		}

		.top-tabs button[data-focus-graph="a"] {
			background: linear-gradient(#eef2f6, #cdd5de);
		}

		.parameter-panel {
			position: absolute;
			right: 0;
			top: 184px;
			width: 390px;
			height: 795px;
			box-sizing: border-box;
			padding: 19px 24px 0;
			background: rgba(231, 237, 244, 0.96) url("assets/Paremetre%20Bar%C4%B1.png") center / 100% 100% no-repeat;
			border-radius: 28px 0 0 28px;
			box-shadow: -8px 0 22px rgba(26, 35, 48, 0.38);
			pointer-events: auto;
			transition: transform 240ms ease;
			overflow: visible;
		}

		#motion-sim-host.params-collapsed .parameter-panel {
			transform: translateX(390px);
		}

		.right-toggle {
			left: -46px;
			top: 304px;
			border-radius: 22px 0 0 22px;
			color: #0b7bd3;
		}

		.panel-buttons {
			display: grid;
			gap: 10px;
			margin: 0 0 42px 18px;
			width: 304px;
		}

		.panel-buttons button {
			width: 304px;
			height: 65px;
			border: 0;
			border-radius: 14px;
			color: #ffffff;
			font: 900 25px/1 Calibri, Arial, sans-serif;
			letter-spacing: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 13px;
			cursor: pointer;
		}

		.panel-buttons span {
			font-size: 31px;
			line-height: 1;
		}

		.start-button {
			background: #11a25b;
		}

		.start-button.is-running {
			background: #d93030;
			filter: none;
		}

		.start-button.is-paused {
			background: #f28c18;
			filter: none;
		}

		.reset-button {
			background: #465263;
		}

		.parameter-values {
			display: grid;
			grid-template-columns: 86px 110px 110px;
			gap: 8px;
			margin-left: 10px;
			position: relative;
			z-index: 5;
		}

		.parameter-values output {
			height: 40px;
			display: grid;
			place-items: center;
			border-radius: 8px;
			background: #d9f0ff;
			color: #26303d;
			font: 900 25px/1 Calibri, Arial, sans-serif;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: clip;
		}

		.slider-grid {
			position: relative;
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 28px;
			margin: 16px 0 0 12px;
			width: 318px;
			height: 520px;
			overflow: visible;
			z-index: 4;
		}

		.vertical-control {
			position: relative;
			display: grid;
			justify-items: center;
			align-content: start;
			height: 520px;
			overflow: visible;
		}

		.vertical-control input {
			position: absolute;
			left: 50%;
			top: 3px;
			width: 76px;
			height: 386px;
			transform: translateX(-50%);
			appearance: slider-vertical;
			-webkit-appearance: slider-vertical;
			background: transparent;
			cursor: pointer;
			opacity: 0;
			z-index: 4;
		}

		.visual-slider {
			position: absolute;
			left: 50%;
			top: 0;
			width: 31px;
			height: 386px;
			transform: translateX(-50%);
			border-radius: 18px;
			background: linear-gradient(90deg, #ffffff, #f4f4f4);
			box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(255, 255, 255, 0.8);
			z-index: 1;
		}

		.visual-knob {
			position: absolute;
			left: 50%;
			bottom: 0;
			width: 59px;
			height: 59px;
			border-radius: 50%;
			border: 2px solid #a9a9a9;
			background: linear-gradient(#eeeeee, #d9d9d9);
			box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.8);
			transform: translate(-50%, 50%);
			z-index: 2;
		}

		.vertical-control span {
			position: absolute;
			bottom: 0;
			width: 92px;
			text-align: center;
			color: #2e2e2e;
			font: 900 25px/0.94 Calibri, Arial, sans-serif;
			display: block;
			z-index: 6;
			text-shadow: 0 1px 0 rgba(255, 255, 255, 0.75);
		}

		.vertical-control strong {
			display: block;
			font-size: 30px;
		}

		.bottom-scale {
			position: absolute;
			left: 631px;
			bottom: 0;
			width: 750px;
			height: 98px;
			background: linear-gradient(#ffffff 0 64%, #d4d4d4 65%, #ececec 68%, #f8f8f8 100%);
			border-radius: 17px 17px 0 0;
			box-shadow: 0 -5px 14px rgba(24, 33, 45, 0.22);
			pointer-events: none;
			overflow: hidden;
		}

		.bottom-scale::before {
			content: "";
			position: absolute;
			left: 0;
			right: 0;
			top: 50px;
			height: 5px;
			background: linear-gradient(#9f9f9f, #f5f5f5);
			z-index: 1;
		}

		.scale-ticks {
			position: absolute;
			left: 18px;
			right: 18px;
			top: 14px;
			height: 44px;
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			z-index: 2;
		}

		.scale-ticks i {
			display: block;
			width: 4px;
			height: 28px;
			background: #000000;
			border-radius: 1px;
		}

		.scale-ticks i.is-major {
			height: 42px;
		}

		.scale-marker {
			position: absolute;
			left: 50%;
			top: 5px;
			width: 5px;
			height: 52px;
			background: #ff1717;
			transform: translateX(-50%);
			z-index: 4;
		}


		@keyframes graphPulse {
			0% { transform: scale(1); }
			45% { transform: scale(1.025); }
			100% { transform: scale(1); }
		}
	`;
	document.head.appendChild(style);
}

function niceRange(values)
{
	let min = Math.floor(Math.min(0, ...values));
	let max = Math.ceil(Math.max(0, ...values));

	if (!Number.isFinite(min) || !Number.isFinite(max))
	{
		min = -1;
		max = 1;
	}

	if (max === min)
	{
		min -= 1;
		max += 1;
	}

	const padding = Math.max(1, Math.ceil((max - min) * 0.12));
	min = Math.floor(min - padding);
	max = Math.ceil(max + padding);
	const span = Math.max(4, max - min);
	max = min + Math.ceil(span / 4) * 4;

	return { min, max };
}

function areaEstimate(points, accessor)
{
	if (points.length < 2)
		return 0;

	let area = 0;
	for (let i = 1; i < points.length; i++)
	{
		const p0 = points[i - 1];
		const p1 = points[i];
		area += ((accessor(p0) + accessor(p1)) / 2) * (p1.t - p0.t);
	}
	return area;
}

function clamp(value, min, max)
{
	return Math.max(min, Math.min(max, value));
}

function wrap(value, min, max)
{
	const range = max - min;
	return ((((value - min) % range) + range) % range) + min;
}

function getDecelerationStopTime(v0, a)
{
	if (Math.abs(v0) < 0.05 || Math.abs(a) < 0.05 || Math.sign(v0) === Math.sign(a))
		return null;

	const stopTime = -v0 / a;
	return stopTime > 0 ? stopTime : null;
}

function trimNumber(value)
{
	return String(Math.round(value));
}
