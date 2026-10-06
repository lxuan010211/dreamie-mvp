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
    stopElement(voice);
    stopElement(background);
    if (context?.state === 'running') void context.suspend?.();
    setState('idle');
  };

  const ensureMixGraph = () => {
    if (!AudioContextCtor || !voice || !background) return false;
    if (!context) context = new AudioContextCtor();
    if (!voiceGain) {
      voiceGain = context.createGain();
      voiceGain.gain.value = 1;
      context.createMediaElementSource(voice).connect(voiceGain).connect(context.destination);
    }
    if (!backgroundGain) {
      backgroundGain = context.createGain();
      backgroundGain.gain.value = 0.18;
      context.createMediaElementSource(background).connect(backgroundGain).connect(context.destination);
    }
    return true;
  };

  const loadVoice = (src, options = {}) => {
    stop();
    voice = new AudioCtor(src);
    voice.preload = 'auto';
    mode = options.mode ?? 'voice';
    voice.addEventListener('ended', stop);
    setState('ready');
  };

  const loadBackground = (src) => {
    background = new AudioCtor(src);
    background.preload = 'auto';
    background.loop = true;
    background.volume = 0.18;
    if (voice) mode = 'voice_with_background';
    else mode = 'background';
    setState('ready');
  };

  const play = async () => {
    if (!voice && !background) return;
    if (mode === 'voice_with_background' && ensureMixGraph()) {
      await context.resume?.();
    }
    setState('playing');
    try {
      const playPromises = [];
      if (voice) playPromises.push(voice.play());
      if (background && (mode === 'background' || mode === 'voice_with_background')) playPromises.push(background.play());
      await Promise.all(playPromises);
    } catch (error) {
      setState('ready');
      throw error;
    }
  };

  return {
    loadVoice,
    loadBackground,
    play,
    stop,
    getState: () => state,
  };
}
