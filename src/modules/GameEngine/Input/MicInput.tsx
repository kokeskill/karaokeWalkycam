// src/modules/GameEngine/Input/MicInput.tsx

import { captureException } from '@sentry/react';
import InputInterface from '~/modules/GameEngine/Input/Interface';
import AubioStrategy from '~/modules/GameEngine/Input/MicStrategies/Aubio';
import events from '~/modules/GameEvents/GameEvents';
import userMediaService from '~/modules/UserMedia/userMediaService';

const micDebugEnabled = () =>
  (typeof window !== 'undefined' && window.localStorage?.getItem('AK_MIC_DEBUG') === '1') || false;

const micLog = (...args: any[]) => {
  if (!micDebugEnabled()) return;
   
  console.log('[AK_MIC]', ...args);
};

const isSpecialDeviceId = (deviceId?: string) => deviceId === 'default' || deviceId === 'communications';

export class MicInput implements InputInterface {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;

  private interval: ReturnType<typeof setInterval> | null = null;

  private frequencies: number[] = [0, 0];
  private volumes: number[] = [0, 0];

  private startedMonitoring = false;

  constructor(private channels = 2) {}

  public startMonitoring = async (deviceId?: string) => {
    if (this.startedMonitoring) return;
    this.startedMonitoring = true;

    // IMPORTANT:
    // Edge/Chromium can hang/fail when using deviceId: { exact: "default" } or "communications".
    // Use a safer constraint in those cases.
    const requestedConstraints: MediaStreamConstraints = {
      audio: isSpecialDeviceId(deviceId)
        ? {
            echoCancellation: false,
          }
        : {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: false,
          },
      video: false,
    };

    try {
      micLog('MicInput.startMonitoring - requesting stream...', { deviceId, requestedConstraints });

      this.stream = await userMediaService.getUserMedia(requestedConstraints);

      const track = this.stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() ?? {};

      micLog('MicInput stream acquired:', {
        requestedDeviceId: deviceId,
        trackReadyState: track?.readyState,
        trackMuted: (track as any)?.muted,
        trackEnabled: track?.enabled,
        settings,
        constraints: track?.getConstraints?.(),
      });

      try {
        this.context = new AudioContext();
        micLog('AudioContext created:', { state: this.context.state, sampleRate: this.context.sampleRate });

        if (this.context.state === 'suspended') {
          await this.context.resume();
          micLog('AudioContext resumed:', { state: this.context.state });
        }

        const source = this.context.createMediaStreamSource(this.stream);

        const analysers = Array.from({ length: this.channels }, () => {
          const analyser = this.context!.createAnalyser();
          analyser.fftSize = 2048;
          analyser.minDecibels = -100;
          return analyser;
        });

        if (this.channels > 1) {
          const splitter = this.context.createChannelSplitter(2);
          source.connect(splitter);
          analysers.forEach((analyser, i) => splitter.connect(analyser, i));
        } else {
          source.connect(analysers[0]);
        }

        const strategy = new AubioStrategy();
        await strategy.init(this.context, analysers[0].fftSize);
        micLog('AubioStrategy init OK');

        let tick = 0;

        this.interval = setInterval(async () => {
          const buffers = analysers.map((analyser) => new Float32Array(analyser.fftSize));
          analysers.forEach((analyser, i) => analyser.getFloatTimeDomainData(buffers[i]));

          const vols = buffers.map((data) => this.calculateVolume(data));
          const freqs = await Promise.all(buffers.map((data) => strategy.getFrequency(data)));

          this.volumes = vols.length >= 2 ? vols : [vols[0] ?? 0, vols[0] ?? 0];
          this.frequencies = freqs.length >= 2 ? freqs : [freqs[0] ?? 0, freqs[0] ?? 0];

          tick++;
          if (micDebugEnabled() && tick % 40 === 0) {
            micLog('MicInput tick:', { vols: this.volumes, freqs: this.frequencies });
          }
        }, this.context.sampleRate / analysers[0].fftSize);

        events.micMonitoringStarted.dispatch();
      } catch (e) {
        captureException(e);
        console.error(e);
      }
    } catch (e: any) {
      // Ensure we can retry after failures/hangs
      this.startedMonitoring = false;

      captureException(e, { level: 'warning', extra: { message: 'MicInput.startMonitoring' } });
      micLog('MicInput.getUserMedia failed:', { name: e?.name, message: e?.message, constraint: e?.constraint });
      console.warn(e);
    }
  };

  public getFrequencies = () => {
    return this.frequencies;
  };

  public getVolumes = () => this.volumes;

  public clearFrequencies = () => undefined;

  public stopMonitoring = async () => {
    if (!this.startedMonitoring) return;
    micLog('MicInput.stopMonitoring');

    this.startedMonitoring = false;

    this.interval && clearInterval(this.interval);
    this.interval = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    try {
      await this.context?.close();
    } catch (e) {
      console.log('MicInput.stopMonitoring error', e);
    }
    this.context = null;

    events.micMonitoringStopped.dispatch();
  };

  public getInputLag = () => 180;

  private calculateVolume(input: Float32Array) {
    let sum = 0.0;
    for (let i = 0; i < input.length; ++i) {
      sum += input[i] * input[i];
    }
    return Math.sqrt(sum / input.length);
  }

  public requestReadiness = () => Promise.resolve(true);

  public getStatus = () => 'ok' as const;
}

export default new MicInput();
