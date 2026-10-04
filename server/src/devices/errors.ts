/** A device read failed in a way worth telling the user about. */
export class DeviceError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }

  static fromSocket(error: NodeJS.ErrnoException, device: string, host: string): DeviceError {
    switch (error.code) {
      case 'ECONNREFUSED':
        return new DeviceError('refused', `${host} refused the connection. Is it a ${device}, and is the IP right?`)
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return new DeviceError('unreachable', `Can't reach ${host} from the Patchbook server. Is it on the same network?`)
      case 'ETIMEDOUT':
        return new DeviceError('timeout', `No answer from ${host}.`)
      default:
        return new DeviceError('network', `Couldn't talk to the ${device} at ${host} (${error.code ?? error.message}).`)
    }
  }
}
