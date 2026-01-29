import InputInterface from '~/modules/GameEngine/Input/Interface';
import { MicInput } from '~/modules/GameEngine/Input/MicInput';
import { SelectedPlayerInput } from '~/modules/Players/PlayersManager';

const isDeviceSelectedForMultipleChannels = (allInputs: SelectedPlayerInput[] = [], deviceId: string | undefined) => {
  const playerInputs = allInputs.filter((input) => input.deviceId === deviceId).map((input) => input.channel);
  return playerInputs.some((channel) => playerInputs[0] !== channel);
};

class MultiMicInput implements InputInterface {
  private devices: Record<string, InputInterface> = {};

  public startMonitoring = async (deviceId?: string, allInputs?: SelectedPlayerInput[]) => {
    if (deviceId) {
      if (!this.devices[deviceId]) {
        this.devices[deviceId] = isDeviceSelectedForMultipleChannels(allInputs, deviceId)
          ? new MicInput(2)
          : new MicInput(1);
      }
      await this.devices[deviceId].startMonitoring(deviceId, allInputs);
    }
  };

  public getFrequencies = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getFrequencies(deviceId) as number[];
    }
    return [0, 0];
  };

  public getVolumes = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getVolumes(deviceId);
    }
    return [0, 0];
  };

  public clearFrequencies = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].clearFrequencies(deviceId);
    }
  };

  // ✅ soporta parar un device específico o todos
  public stopMonitoring = async (deviceId?: string) => {
    if (deviceId) {
      const dev = this.devices[deviceId];
      if (dev) {
        await dev.stopMonitoring(deviceId);
        delete this.devices[deviceId];
      }
      return;
    }

    await Promise.all(Object.values(this.devices).map((device) => device.stopMonitoring()));
    this.devices = {};
  };

  public getInputLag = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getInputLag(deviceId);
    }
    return 180;
  };

  public requestReadiness = async (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].requestReadiness(deviceId);
    }
    return true;
  };

  // ✅ FIRMA corregida para coincidir con InputInterface
  public getStatus = (deviceId?: string, channel?: number) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getStatus(deviceId, channel);
    }
    return 'ok' as const;
  };
}

export default new MultiMicInput();
