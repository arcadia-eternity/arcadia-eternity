declare module 'ioredis-mock' {
  import Redis from 'ioredis'

  export default class RedisMock extends Redis {
    duplicate(): RedisMock
  }
}
