// src/modules/UserMedia/userMediaService.ts

import Listener from '~/modules/utils/Listener';

type accessStatus = 'uninitialised' | 'requested' | 'accepted' | 'declined';

const micDebugEnabled = () =>
  (typeof window !== 'undefined' && window.localStorage?.getItem('AK_MIC_DEBUG') === '1') || false;

const micLog = (...args: any[]) => {
  if (!micDebugEnabled()) return;
   
  console.log('[AK_MIC]', ...args);
};

class UserMediaService extends Listener<[accessStatus]> {
  private status: accessStatus = 'uninitialised';

  public getUserMedia: typeof navigator.mediaDevices.getUserMedia = async (...args) =>
    this.requestAndTrack(() => {
      micLog('getUserMedia called with:', args?.[0]);
      return navigator.mediaDevices.getUserMedia(...args);
    });

  public enumerateDevices: typeof navigator.mediaDevices.enumerateDevices = async (...args) =>
    this.requestAndTrack(() => {
      micLog('enumerateDevices called');
      return navigator.mediaDevices.enumerateDevices(...args);
    });

  private requestAndTrack = async <T extends CallableFunction>(fnc: T) => {
    try {
      if (this.status !== 'accepted') this.setStatus('requested');
      const result = await fnc();
      this.setStatus('accepted');
      micLog('requestAndTrack accepted');
      return result;
    } catch (e: any) {
      this.setStatus('declined');
      micLog('requestAndTrack declined:', {
        name: e?.name,
        message: e?.message,
        constraint: e?.constraint,
      });
      throw e;
    }
  };

  private setStatus = (newStatus: accessStatus) => {
    this.status = newStatus;
    this.onUpdate(newStatus);
  };

  public getStatus = () => this.status;
}

export default new UserMediaService();
