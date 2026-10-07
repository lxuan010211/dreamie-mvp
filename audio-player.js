function defaultAudioContextCtor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext;
}

export function createAudioPlaybackController({
  AudioCtor = globalThis.Audio,
  AudioContextCtor = defaultAudioContextCtor(),
  onStateChange = () => {},
} = {}) {
  let voice;
  let background;
  let mode = 'voice';
  let state = 'idle';
  let context;
  let voiceGain;
  let backgroundGain;
  let voiceSource;
  let backgroundSource;
  let operation = 0;

  const setState = (nextState) => {
    state = nextState;
    onStateChange(state);
  };

  const stopElement = (element) => {
    if (!element) return;
    element.pause();
    try {
      element.currentTime = 0;
    } catch {
      // Some test doubles and media elements can reject currentTime resets.
    }
  };

  const stop = () => {
    operation += 1;
    stopElement(voice);
    stopElement(background);
    if (context?.state === 'running') void context.suspend?.();
    setState('idle');
  };

  const resetGraph = () => {
    voiceSource?.disconnect?.();
    backgroundSource?.disconnect?.();
    voiceGain?.disconnect?.();
    backgroundGain?.disconnect?.();
    voiceSource = undefined;
    backgroundSource = undefined;
    voiceGain = undefined;
    backgroundGain = undefined;
  };

  const reset = () => {
    stop();
    resetGraph();
    voice = undefined;
    background = undefined;
    mode = 'voice';
  };

  const ensureMixGraph = () => {
    if (!AudioContextCtor || !voice || !background) return false;
    // The graph controls ambience volume; do not attenuate it a second time.
    background.volume = 1;
    if (!context) context = new AudioContextCtor();
    if (!voiceGain) {
      voiceGain = context.createGain();
      voiceGain.gain.value = 1;
      voiceSource = context.createMediaElementSource(voice);
      voiceSource.connect(voiceGain).connect(context.destination);
    }
    if (!backgroundGain) {
      backgroundGain = context.createGain();
      backgroundGain.gain.value = 0.18;
      backgroundSource = context.createMediaElementSource(background);
      backgroundSource.connect(backgroundGain).connect(context.destination);
    }
    return true;
  };

  const loadVoice = (src, options = {}) => {
    reset();
    voice = new AudioCtor(src);
    voice.preload = 'auto';
    mode = options.mode ?? 'voice';
    voice.addEventListener('ended', stop);
    setState('ready');
  };

  const loadBackground = (src, options = {}) => {
    if (!options.preserveVoice) reset();
    else stopElement(background);
    background = new AudioCtor(src);
    background.preload = 'auto';
    background.loop = true;
    background.volume = 0.18;
    if (options.preserveVoice && voice) mode = options.mode ?? 'voice_with_background';
    else mode = 'background';
    setState('ready');
  };

  const play = async () => {
    if (!voice && !background) return;
    const currentOperation = operation;
    if (mode === 'voice_with_background' && ensureMixGraph()) {
      await context.resume?.();
    }
    setState('playing');
    try {
      const playPromises = [];
      if (voice && mode !== 'background') playPromises.push(voice.play());
      if (background && (mode === 'background' || mode === 'voice_with_background')) playPromises.push(background.play());
      await Promise.all(playPromises);
      if (currentOperation !== operation) return;
    } catch (error) {
      if (currentOperation !== operation) return;
      stopElement(voice);
      stopElement(background);
      if (context?.state === 'running') void context.suspend?.();
      setState('ready');
      throw error;
    }
  };

  return {
    loadVoice,
    loadBackground,
    reset,
    play,
    stop,
    getState: () => state,
  };
}
