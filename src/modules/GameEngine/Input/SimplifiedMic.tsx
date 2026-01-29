// src/modules/GameEngine/Input/SimplifiedMic.tsx

import { captureException } from '@sentry/react';
import InputInterface from '~/modules/GameEngine/Input/Interface';
import AubioStrategy from '~/modules/GameEngine/Input/MicStrategies/Aubio';
import events from '~/modules/GameEvents/GameEvents';
import userMediaService from '~/modules/UserMedia/userMediaService';
import Listener from '~/modules/utils/Listener';

const micDebugEnabled = () =>
  (typeof window !== 'undefined' && window.localStorage?.getItem('AK_MIC_DEBUG') === '1') || false;

const micLog = (...args: any[]) => {
  if (!micDebugEnabled()) return;
   
  console.log('[AK_MIC]', ...args);
};

class SimplifiedMic extends Listener<[number, number]> implements InputInterface {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;

  private interval: ReturnType<typeof setInterval> | null = null;

  private frequencies: [number, number] = [0, 0];
  private volumes: [number, number] = [0, 0];

  private startedMonitoring = false;

  public startMonitoring = async () => {
    if (this.startedMonitoring) return;
    this.startedMonitoring = true;

    try {
      micLog('SimplifiedMic.startMonitoring - requesting stream...');
      this.stream = await userMediaService.getUserMedia({
        audio: {
          // echoCancellation is turned on because without it there is silence from the mic
          // every other second (possibly some kind of Chrome Mobile bug)
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });

      const track = this.stream.getAudioTracks()[0];
      micLog('SimplifiedMic stream acquired:', {
        readyState: track?.readyState,
        muted: (track as any)?.muted,
        enabled: track?.enabled,
        settings: track?.getSettings?.(),
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

        const analyserCh0 = this.context.createAnalyser();
        analyserCh0.fftSize = 2048;
        analyserCh0.minDecibels = -100;
        source.connect(analyserCh0);

        const strategy = new AubioStrategy();
        await strategy.init(this.context, analyserCh0.fftSize);
        micLog('AubioStrategy init OK');

        let tick = 0;

        this.interval = setInterval(async () => {
          const dataCh0 = new Float32Array(analyserCh0.fftSize);

          analyserCh0.getFloatTimeDomainData(dataCh0);
          const volume = this.calculateVolume(dataCh0);
          const freq = await strategy.getFrequency(dataCh0);

          this.frequencies = [freq, freq];
          this.volumes = [volume, volume];
          this.onUpdate(freq, volume);

          tick++;
          if (micDebugEnabled() && tick % 40 === 0) {
            micLog('SimplifiedMic tick:', { volume, freq });
          }
        }, this.context.sampleRate / analyserCh0.fftSize);

        events.micMonitoringStarted.dispatch();
      } catch (e) {
        captureException(e);
        console.error(e);
      }
    } catch (e: any) {
      if (e.name !== 'NotAllowedError') {
        captureException(e, { level: 'warning', extra: { message: 'SimplifiedMic.startMonitoring' } });
      }
      micLog('SimplifiedMic.getUserMedia failed:', { name: e?.name, message: e?.message, constraint: e?.constraint });
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
    micLog('SimplifiedMic.stopMonitoring');
    this.startedMonitoring = false;
    this.interval && clearInterval(this.interval);
    this.stream?.getTracks().forEach(function (track) {
      track.stop();
    });
    try {
      await this.context?.close();
    } catch (e) {
      console.log('MicInput.stoMonitoring error', e);
    }

    events.micMonitoringStopped.dispatch();
  };

  public getInputLag = () => 180;

  private calculateVolume(input: Float32Array) {
    let i;
    let sum = 0.0;
    for (i = 0; i < input.length; ++i) {
      sum += input[i] * input[i];
    }
    return Math.sqrt(sum / input.length);
  }
  public requestReadiness = () => Promise.resolve(true);

  public getStatus = () => 'ok' as const;
}

export default new SimplifiedMic();
