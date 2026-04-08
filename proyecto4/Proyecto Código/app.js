(function () {
  const estado = document.getElementById("estado");
  const texto = document.getElementById("texto");
  const respuesta = document.getElementById("respuesta");
  const hablarBtn = document.getElementById("hablar");
  const compatibilidad = document.getElementById("compatibilidad");
  const manualInput = document.getElementById("manualInput");
  const suggestionText = document.getElementById("suggestionText");
  const activarCamaraBtn = document.getElementById("activarCamara");
  const detenerCamaraBtn = document.getElementById("detenerCamara");

  const lamp = document.getElementById("lamp");
  const lightHalo = document.getElementById("lightHalo");
  const door = document.getElementById("door");
  const doorSpark = document.getElementById("doorSpark");
  const confirmPanel = document.getElementById("confirmPanel");
  const actionBadge = document.getElementById("actionBadge");

  const metricErrors = document.getElementById("metricErrors");
  const metricSuccess = document.getElementById("metricSuccess");
  const metricAttempts = document.getElementById("metricAttempts");
  const metricTime = document.getElementById("metricTime");

  const video = document.getElementById("cameraFeed");
  const canvas = document.getElementById("gestureCanvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const cameraStatus = document.getElementById("cameraStatus");
  const gestureCountBadge = document.getElementById("gestureCountBadge");
  const gestureCommandBadge = document.getElementById("gestureCommandBadge");

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

  let rec = null;
  let panelTimeout = null;
  let state = "IDLE";
  let isSpeaking = false;
  let ignoreVoiceUntil = 0;
  let lastSystemSpeechNormalized = "";
  let resumeAfterSpeak = false;
  let autoRestartVoice = true;
  let introPlayed = false;
  let stopRequested = false;
  let pending = null;
  let light = false;
  let doorOpen = false;
  let blindsOpen = false;

  let errors = 0;
  let successes = 0;
  let attempts = 0;
  let taskStartTime = null;

  let cameraStream = null;
  let cameraRunning = false;
  let lastStableCommand = null;
  let stableFrames = 0;
  let lastGestureTriggerTime = 0;
  const GESTURE_STABLE_FRAMES = 8;
  const GESTURE_COOLDOWN_MS = 2200;

  let hands = null;
  if (window.Hands) {
    hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6
    });
  }

  function setEstado(value) { if (estado) estado.textContent = value; }
  function setTexto(value) { if (texto) texto.textContent = value || "---"; }
  function setRespuesta(value) { if (respuesta) respuesta.textContent = value || "---"; }
  function setCompatibilidad(value) { if (compatibilidad) compatibilidad.textContent = value; }
  function setActionBadge(text) { if (actionBadge) actionBadge.textContent = text; }
  function setSuggestion(value) { if (suggestionText) suggestionText.textContent = value; }
  function setCameraStatus(value) { if (cameraStatus) cameraStatus.textContent = value; }
  function setGestureCount(value) { if (gestureCountBadge) gestureCountBadge.textContent = value; }
  function setGestureCommand(value) { if (gestureCommandBadge) gestureCommandBadge.textContent = value; }

  function updateMetrics() {
    if (metricErrors) metricErrors.textContent = String(errors);
    if (metricSuccess) metricSuccess.textContent = String(successes);
    if (metricAttempts) metricAttempts.textContent = String(attempts);
  }

  function startTaskTimer() {
    taskStartTime = performance.now();
    if (metricTime) metricTime.textContent = "0.0 s";
  }

  function finishTaskTimer() {
    if (taskStartTime === null) return;
    const seconds = ((performance.now() - taskStartTime) / 1000).toFixed(1);
    if (metricTime) metricTime.textContent = seconds + " s";
    taskStartTime = null;
  }

  function setPanel(mode, title, subtitle) {
    const icon = mode === "success" ? "✅" :
                 mode === "cancel" ? "❌" :
                 mode === "pending" ? "⏳" :
                 mode === "info" ? "ℹ️" : "🗣️";
    confirmPanel.className = "confirm-panel " + mode;
    confirmPanel.innerHTML =
      '<div class="confirm-icon">' + icon + '</div>' +
      '<div class="confirm-text"><strong>' + title + '</strong><span>' + subtitle + '</span></div>';
  }

  function syncScene() {
    if (lamp) lamp.classList.toggle("on", light);
    if (lightHalo) lightHalo.classList.toggle("active", light);
    if (door) door.classList.toggle("open", doorOpen);
    const blinds = document.getElementById("blinds");
    if (blinds) blinds.classList.toggle("open", blindsOpen);
  }

  function flashDoorSpark() {
    if (!doorSpark) return;
    doorSpark.classList.add("active");
    setTimeout(() => doorSpark.classList.remove("active"), 900);
  }

  function restartListeningAfterSpeak(delay = 180) {
    if (!rec || stopRequested || !autoRestartVoice) return;
    setTimeout(() => {
      try {
        rec.start();
      } catch (err) {}
    }, delay);
  }

  function speak(txt) {
    try {
      window.speechSynthesis.cancel();
      setRespuesta(txt);
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = "es-ES";
      u.rate = 1;
      isSpeaking = true;
      ignoreVoiceUntil = Date.now() + 1400;
      lastSystemSpeechNormalized = normalizeText(txt);

      u.onend = () => {
        isSpeaking = false;
        ignoreVoiceUntil = Date.now() + 900;
      };

      u.onerror = () => {
        isSpeaking = false;
        ignoreVoiceUntil = Date.now() + 700;
      };

      window.speechSynthesis.speak(u);
    } catch (err) {
      isSpeaking = false;
      console.error("speech error", err);
    }
  }

  function normalizeText(text) {
    return (text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[¿?¡!.,;:]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectIntent(text) {
    const t = normalizeText(text);
    const compact = t.replace(/\s+/g, " ").trim();

    if (state === "CONFIRM") {
      if (
        compact === "1" ||
        compact === "uno" ||
        compact === "si" ||
        compact === "si confirmo" ||
        compact === "si confirma" ||
        compact === "sí" ||
        compact === "sí confirmo" ||
        compact === "sí confirma"
      ) return "YES_CONFIRM";

      if (
        compact === "2" ||
        compact === "dos" ||
        compact === "no" ||
        compact === "no confirmo" ||
        compact === "no confirma"
      ) return "NO_CONFIRM";
    }

    if (t.includes("encender luz") || t.includes("prender luz")) return "TURN_ON_LIGHT";
    if (t.includes("apagar luz")) return "TURN_OFF_LIGHT";
    if (t.includes("abrir puerta")) return "OPEN_DOOR";
    if (t.includes("cerrar puerta")) return "CLOSE_DOOR";
    if (t.includes("abrir persianas") || t.includes("subir persianas")) return "OPEN_BLINDS";
    if (t.includes("cerrar persianas") || t.includes("bajar persianas")) return "CLOSE_BLINDS";
    if (t.includes("estado general") || t === "estado") return "STATUS";
    if (t.includes("ayuda") || t.includes("qué puedes hacer") || t.includes("que puedes hacer")) return "HELP";
    if (t.includes("cancelar")) return "CANCEL";
    if (t.includes("sí confirmo") || t.includes("si confirmo") || t.includes("sí confirma") || t.includes("si confirma")) return "YES_CONFIRM";
    if (t.includes("no confirmo") || t.includes("no confirma")) return "NO_CONFIRM";
    return "UNKNOWN";
  }

  function suggestCommand(text) {
    const t = normalizeText(text);
    if (t.includes("luz") || t.includes("prender") || t.includes("enciende")) return "¿Quisiste decir encender luz?";
    if (t.includes("apaga") || t.includes("oscuro")) return "¿Quisiste decir apagar luz?";
    if (t.includes("puerta") && t.includes("abre")) return "¿Quisiste decir abrir puerta?";
    if (t.includes("puerta") && t.includes("cierra")) return "¿Quisiste decir cerrar puerta?";
    if (t.includes("persiana") && (t.includes("sube") || t.includes("abre"))) return "¿Quisiste decir abrir persianas?";
    if (t.includes("persiana") && (t.includes("baja") || t.includes("cierra"))) return "¿Quisiste decir cerrar persianas?";
    if (t.includes("ventana")) return "Prueba con abrir persianas o cerrar persianas.";
    return "Comandos sugeridos: Encender luz, Abrir puerta, Abrir persianas, Estado, Ayuda.";
  }

  function labelFor(intent) {
    if (intent === "TURN_ON_LIGHT") return "Encender luz";
    if (intent === "TURN_OFF_LIGHT") return "Apagar luz";
    if (intent === "OPEN_DOOR") return "Abrir puerta";
    if (intent === "CLOSE_DOOR") return "Cerrar puerta";
    if (intent === "OPEN_BLINDS") return "Abrir persianas";
    if (intent === "CLOSE_BLINDS") return "Cerrar persianas";
    if (intent === "STATUS") return "Estado";
    if (intent === "CANCEL") return "Cancelar";
    if (intent === "YES_CONFIRM") return "Sí confirmo";
    if (intent === "NO_CONFIRM") return "No confirmo";
    if (intent === "HELP") return "Ayuda";
    return "Acción";
  }

  function execute(intent) {
    if (intent === "TURN_ON_LIGHT") {
      if (light) return "La luz ya está encendida.";
      light = true;
      return "Luz encendida correctamente.";
    }
    if (intent === "TURN_OFF_LIGHT") {
      if (!light) return "La luz ya está apagada.";
      light = false;
      return "Luz apagada correctamente.";
    }
    if (intent === "OPEN_DOOR") {
      if (doorOpen) return "La puerta ya está abierta.";
      doorOpen = true;
      return "Puerta abierta correctamente.";
    }
    if (intent === "CLOSE_DOOR") {
      if (!doorOpen) return "La puerta ya está cerrada.";
      doorOpen = false;
      return "Puerta cerrada correctamente.";
    }
    if (intent === "OPEN_BLINDS") {
      if (blindsOpen) return "Las persianas ya están abiertas.";
      blindsOpen = true;
      return "Persianas abiertas correctamente.";
    }
    if (intent === "CLOSE_BLINDS") {
      if (!blindsOpen) return "Las persianas ya están cerradas.";
      blindsOpen = false;
      return "Persianas cerradas correctamente.";
    }
    return "No se pudo ejecutar la acción solicitada.";
  }

  function processCommand(text) {
    const intent = detectIntent(text);

    if (state === "CONFIRM") {
      if (intent === "YES_CONFIRM") {
        state = "IDLE";
        const action = pending;
        pending = null;
        successes += 1;
        finishTaskTimer();
        updateMetrics();
        setSuggestion("Última acción confirmada correctamente.");
        return { speech: execute(action), uiState: "success", actionBadge: "Acción confirmada" };
      }
      if (intent === "NO_CONFIRM" || intent === "CANCEL") {
        state = "IDLE";
        pending = null;
        errors += 1;
        finishTaskTimer();
        updateMetrics();
        setSuggestion("La acción fue cancelada por el usuario.");
        return { speech: "Acción cancelada. Puedes indicar otro comando.", uiState: "cancel", actionBadge: "Acción cancelada" };
      }
      errors += 1;
      updateMetrics();
      setSuggestion("Debes responder exactamente con Sí confirmo o No confirmo.");
      return { speech: "Debes decir Sí confirmo o No confirmo.", uiState: "pending", actionBadge: "Esperando confirmación" };
    }

    if (intent === "UNKNOWN") {
      errors += 1;
      updateMetrics();
      const sug = suggestCommand(text);
      setSuggestion(sug);
      return { speech: "No entendí el comando. " + sug, uiState: "idle", actionBadge: "Comando no reconocido" };
    }

    if (intent === "HELP") {
      setSuggestion("Puedes controlar luz, puerta, persianas, consultar estado y confirmar acciones.");
      return {
        speech: "Puedo encender luz, apagar luz, abrir puerta, cerrar puerta, abrir persianas, cerrar persianas y darte el estado general.",
        uiState: "info",
        actionBadge: "Ayuda del sistema"
      };
    }

    if (intent === "STATUS") {
      setSuggestion("Consulta completada correctamente.");
      return {
        speech: "La luz está " + (light ? "encendida" : "apagada") + ", la puerta está " + (doorOpen ? "abierta" : "cerrada") + " y las persianas están " + (blindsOpen ? "abiertas" : "cerradas") + ".",
        uiState: "info",
        actionBadge: "Consulta de estado"
      };
    }

    if (intent === "CANCEL") {
      state = "IDLE";
      pending = null;
      errors += 1;
      finishTaskTimer();
      updateMetrics();
      setSuggestion("No había una acción activa o fue detenida manualmente.");
      return { speech: "No hay una acción pendiente. El sistema sigue disponible.", uiState: "cancel", actionBadge: "Sin acción pendiente" };
    }

    attempts += 1;
    startTaskTimer();
    updateMetrics();

    pending = intent;
    state = "CONFIRM";

    let speech = "Debes decir Sí confirmo o No confirmo.";
    if (intent === "TURN_ON_LIGHT") speech = "Vas a encender la luz. Di Sí confirmo o No confirmo.";
    if (intent === "TURN_OFF_LIGHT") speech = "Vas a apagar la luz. Di Sí confirmo o No confirmo.";
    if (intent === "OPEN_DOOR") speech = "Vas a abrir la puerta. Di Sí confirmo o No confirmo.";
    if (intent === "CLOSE_DOOR") speech = "Vas a cerrar la puerta. Di Sí confirmo o No confirmo.";
    if (intent === "OPEN_BLINDS") speech = "Vas a abrir las persianas. Di Sí confirmo o No confirmo.";
    if (intent === "CLOSE_BLINDS") speech = "Vas a cerrar las persianas. Di Sí confirmo o No confirmo.";

    setSuggestion("Sugerencia activa: " + labelFor(intent) + ".");
    return { speech: speech, uiState: "pending", actionBadge: "Pendiente: " + labelFor(intent) };
  }

  function handleResult(result) {
    clearTimeout(panelTimeout);

    if (result.uiState === "pending") {
      setPanel("pending", "Confirmación requerida", "Responde con Sí confirmo o No confirmo.");
    } else if (result.uiState === "success") {
      setPanel("success", "Acción ejecutada", result.speech);
    } else if (result.uiState === "cancel") {
      setPanel("cancel", "Acción detenida", result.speech);
    } else if (result.uiState === "info") {
      setPanel("info", "Estado consultado", result.speech);
    } else {
      setPanel("idle", "Esperando comando", result.speech);
    }

    setActionBadge(result.actionBadge || "Sin acción reciente");
    syncScene();

    const lowered = (result.speech || "").toLowerCase();
    if (lowered.includes("puerta abierta") || lowered.includes("puerta cerrada")) flashDoorSpark();

    panelTimeout = setTimeout(() => {
      if (["success", "cancel", "info"].some(cls => confirmPanel.classList.contains(cls))) {
        setPanel("idle", "Esperando comando", "Di una instrucción para comenzar");
      }
    }, 2200);
  }

  function getDisplayText(inputText) {
    const intent = detectIntent(inputText);
    if (intent === "YES_CONFIRM") return "si confirmo";
    if (intent === "NO_CONFIRM") return "no confirmo";
    return inputText;
  }

  function processAndRender(inputText, source = "voz") {
    setTexto(getDisplayText(inputText));
    const result = processCommand(inputText);
    if (source === "gesto") {
      setSuggestion("Gesto detectado: " + getDisplayText(inputText) + ". Ejecutado desde la cámara.");
    }
    speak(result.speech);
    handleResult(result);
  }

  function startListening() {
    setEstado("Solicitando micrófono...");
    setCompatibilidad("Si Chrome pide permiso, pulsa Permitir.");
    if (hablarBtn) hablarBtn.classList.add("listening");

    if (!SpeechRecognitionClass) {
      if (hablarBtn) hablarBtn.classList.remove("listening");
      setEstado("Navegador no compatible");
      setCompatibilidad("Tu navegador no soporta reconocimiento de voz. Usa Chrome.");
      alert("Tu navegador no soporta reconocimiento de voz. Usa Google Chrome.");
      return;
    }

    if (!rec) {
      rec = new SpeechRecognitionClass();
      rec.lang = "es-ES";
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        stopRequested = false;
        setEstado("Escuchando...");
        setCompatibilidad("Micrófono activo. Habla ahora.");
        setPanel("info", "Escuchando", "Habla ahora para indicar una acción.");
        if (!introPlayed) {
          introPlayed = true;
          setTimeout(() => speak("Sistema listo. Puedes decir un comando como encender luz, abrir puerta o consultar estado."), 700);
        }
      };

      rec.onresult = (e) => {
        const result = e.results[e.resultIndex] || e.results[e.results.length - 1];
        if (!result || result.isFinal === false || !result[0]) return;
        const transcript = (result[0].transcript || "").trim();
        if (!transcript) return;

        const normalizedTranscript = normalizeText(transcript);
        if (isSpeaking || Date.now() < ignoreVoiceUntil) return;
        if (lastSystemSpeechNormalized && normalizedTranscript && (
          lastSystemSpeechNormalized.includes(normalizedTranscript) ||
          normalizedTranscript.includes(lastSystemSpeechNormalized)
        )) {
          return;
        }

        processAndRender(transcript, "voz");
      };

      rec.onerror = (e) => {
        if (hablarBtn) hablarBtn.classList.remove("listening");
        setEstado("Error de reconocimiento");
        let msg = "Hubo un error al reconocer la voz.";
        if (e.error === "not-allowed") msg = "Debes permitir el micrófono en Chrome.";
        if (e.error === "no-speech") {
          setEstado("Escuchando...");
          setCompatibilidad("Micrófono activo. Sigue hablando cuando quieras.");
          return;
        }
        errors += 1;
        updateMetrics();
        if (e.error === "audio-capture") msg = "No se detectó micrófono disponible.";
        if (e.error === "aborted" && stopRequested) {
          setCompatibilidad("Audio detenido manualmente.");
          return;
        }
        setCompatibilidad(msg);
        setSuggestion("Error detectado. Verifica micrófono o usa la entrada manual.");
        speak(msg);
        console.error(e.error);
      };

      rec.onend = () => {
        if (isSpeaking) {
          setEstado(state === "CONFIRM" ? "Esperando confirmación" : "Hablando...");
          return;
        }
        if (stopRequested || !autoRestartVoice) {
          if (hablarBtn) hablarBtn.classList.remove("listening");
          setEstado("Audio detenido");
          setCompatibilidad("Audio detenido. Puedes volver a iniciarlo cuando quieras.");
          return;
        }
        setEstado(state === "CONFIRM" ? "Esperando confirmación" : "Reactivando escucha...");
        setCompatibilidad(state === "CONFIRM" ? "Ahora responde con Sí confirmo o No confirmo." : "Modo manos libres activo. El sistema seguirá escuchando.");
        setTimeout(() => {
          try { rec.start(); } catch (err) {}
        }, 350);
      };
    }

    stopRequested = false;
    setTexto("---");
    try {
      rec.start();
    } catch (err) {
      if (hablarBtn) hablarBtn.classList.remove("listening");
      setEstado("No se pudo iniciar");
      setCompatibilidad("Intenta nuevamente en unos segundos.");
      errors += 1;
      updateMetrics();
      setSuggestion("Si persiste, usa la entrada manual o revisa permisos del navegador.");
      console.error(err);
    }
  }

  function stopEverything() {
    stopRequested = true;
    window.speechSynthesis.cancel();
    if (rec) {
      try { rec.stop(); } catch (e) {}
    }
    if (hablarBtn) hablarBtn.classList.remove("listening");
    setEstado("Audio detenido");
    setCompatibilidad("Audio detenido manualmente.");
    setPanel("idle", "Esperando comando", "El audio se detuvo. Puedes volver a hablar.");
    setSuggestion("Sistema en pausa. Puedes reiniciar cuando quieras.");
  }

  function runManualCommand() {
    const value = manualInput.value.trim();
    if (!value) return;
    processAndRender(value, "manual");
    manualInput.value = "";
  }

  function gestureToCommand(fingerCount) {
    return ({
      1: "sí confirmo",
      2: "no confirmo",
      3: "encender luz",
      4: "apagar luz",
      5: "abrir puerta",
      6: "cerrar puerta",
      7: "abrir persianas",
      8: "cerrar persianas",
      9: "estado",
      10: "cancelar"
    })[fingerCount] || null;
  }

  function countFingersForHand(landmarks, handednessLabel) {
    let count = 0;
    const thumbTip = landmarks[4];
    const thumbIp = landmarks[3];
    const isRight = handednessLabel === "Right";
    const thumbOpen = isRight ? thumbTip.x < thumbIp.x : thumbTip.x > thumbIp.x;
    if (thumbOpen) count += 1;

    const tipIds = [8, 12, 16, 20];
    const pipIds = [6, 10, 14, 18];
    for (let i = 0; i < tipIds.length; i += 1) {
      if (landmarks[tipIds[i]].y < landmarks[pipIds[i]].y) count += 1;
    }
    return count;
  }

  function resizeCanvasToVideo() {
    if (!video || !canvas) return;
    const rect = video.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function clearGestureOverlay() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  if (hands) {
    hands.onResults((results) => {
      resizeCanvasToVideo();
      clearGestureOverlay();

      let totalFingers = 0;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (let i = 0; i < results.multiHandLandmarks.length; i += 1) {
          const landmarks = results.multiHandLandmarks[i];
          const handednessLabel = (results.multiHandedness && results.multiHandedness[i] && results.multiHandedness[i].label) || "Right";
          totalFingers += countFingersForHand(landmarks, handednessLabel);

          if (ctx && window.drawConnectors && window.drawLandmarks && window.HAND_CONNECTIONS) {
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "#b06cff", lineWidth: 3 });
            drawLandmarks(ctx, landmarks, { color: "#7b4dff", lineWidth: 1, radius: 4 });
          }
        }
      }

      const command = gestureToCommand(totalFingers);
      const now = Date.now();

      setGestureCount(`${totalFingers} dedo${totalFingers === 1 ? "" : "s"}`);
      if (command) {
        const badgeMap = {
          1: "1. Sí confirmo",
          2: "2. No confirmo",
          3: "3. Encender luz",
          4: "4. Apagar luz",
          5: "5. Abrir puerta",
          6: "6. Cerrar puerta",
          7: "7. Abrir persianas",
          8: "8. Cerrar persianas",
          9: "9. Estado",
          10: "10. Cancelar"
        };
        setGestureCommand(badgeMap[totalFingers] || "Gesto detectado");

        if (lastStableCommand === command) {
          stableFrames += 1;
        } else {
          lastStableCommand = command;
          stableFrames = 1;
        }

        if (stableFrames >= GESTURE_STABLE_FRAMES && now - lastGestureTriggerTime > GESTURE_COOLDOWN_MS) {
          lastGestureTriggerTime = now;
          processAndRender(command, "gesto");
        }
      } else {
        lastStableCommand = null;
        stableFrames = 0;
        setGestureCommand(totalFingers === 0 ? "Sin gesto detectado" : "Cantidad sin comando asignado");
      }
    });
  }

  async function detectionLoop() {
    if (!cameraRunning || !hands || !video) return;
    if (!video.videoWidth || !video.videoHeight) {
      requestAnimationFrame(detectionLoop);
      return;
    }
    try {
      await hands.send({ image: video });
    } catch (err) {
      console.error("hands.send error", err);
    }
    if (cameraRunning) requestAnimationFrame(detectionLoop);
  }

  async function startCamera() {
    if (cameraRunning) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus("No disponible");
      setSuggestion("Tu navegador no soporta cámara.");
      return;
    }
    if (!hands) {
      setCameraStatus("MediaPipe no cargó");
      setSuggestion("No se pudo cargar MediaPipe. Revisa la conexión a internet.");
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = cameraStream;
      await video.play();
      cameraRunning = true;
      setCameraStatus("Cámara activa");
      setCompatibilidad("Micrófono y cámara listos para interactuar.");
      setSuggestion("Puedes usar voz o mostrar dedos frente a la cámara.");
      if (activarCamaraBtn) activarCamaraBtn.disabled = true;
      if (detenerCamaraBtn) detenerCamaraBtn.disabled = false;
      requestAnimationFrame(detectionLoop);
    } catch (error) {
      cameraRunning = false;
      errors += 1;
      updateMetrics();
      setCameraStatus("Permiso denegado");
      setSuggestion("Debes permitir acceso a la cámara en Chrome para usar gestos.");
      console.error(error);
    }
  }

  function stopCamera() {
    cameraRunning = false;
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    if (video) video.srcObject = null;
    clearGestureOverlay();
    setCameraStatus("Cámara apagada");
    setGestureCount("0 dedos");
    setGestureCommand("Sin gesto detectado");
    if (activarCamaraBtn) activarCamaraBtn.disabled = false;
    if (detenerCamaraBtn) detenerCamaraBtn.disabled = true;
    lastStableCommand = null;
    stableFrames = 0;
  }

  window.startListening = startListening;
  window.stopEverything = stopEverything;
  window.runManualCommand = runManualCommand;
  window.startCamera = startCamera;
  window.stopCamera = stopCamera;

  if (manualInput) {
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runManualCommand();
    });
  }

  syncScene();
  setPanel("idle", "Esperando comando", "Di una instrucción para comenzar");
  updateMetrics();
  setSuggestion("Comandos recomendados: Encender luz, Cerrar puerta, Abrir persianas, Ayuda.");
  setCameraStatus("Cámara apagada");
  setGestureCount("0 dedos");
  setGestureCommand("Sin gesto detectado");
  if (detenerCamaraBtn) detenerCamaraBtn.disabled = true;
})();
