/** Official Workshop trust anchor: root/1.json of github.com/arcadia-eternity/arcadia-workshop. */
import type { SignedEnvelope } from './signing'

export const OFFICIAL_WORKSHOP_ROOT: SignedEnvelope<unknown> = {
  signatures: [
    {
      keyid: '06c32fdd5d6b355fe619d6f507bed1566c1d553419f2d8c4d365d4705a591e3d',
      sig: 'mqUIfZWZ9Am5r7fE/zlsI8AHJRrVTk2IZp8u+907ZblPFBEGefsXi7M7Mhn3rEn6fdlOkCoerdav9TcP2lCPCg==',
    },
  ],
  signed: {
    expires: '2027-11-27T07:33:24.148Z',
    keys: {
      '06c32fdd5d6b355fe619d6f507bed1566c1d553419f2d8c4d365d4705a591e3d': {
        keytype: 'ed25519',
        public: 'r/ExliXzO20liHFdzcXxT1ekQ2y35PL3duyTPaLcprk=',
      },
      '904ef71e5f4052c81999889545c5d029ceb9623522d0aaa045ee36c8317ad7aa': {
        keytype: 'ed25519',
        public: 'GOfQW3O65+oLDBjdmiwEXCMD2LhlQb76YKvfjqS6+gY=',
      },
    },
    mirrors: [
      'https://arcadia-eternity.github.io/arcadia-workshop/',
      'https://cdn.jsdelivr.net/gh/arcadia-eternity/arcadia-workshop@site/',
    ],
    registry: 'official',
    roles: {
      root: {
        keyids: ['06c32fdd5d6b355fe619d6f507bed1566c1d553419f2d8c4d365d4705a591e3d'],
        threshold: 1,
      },
      snapshot: {
        keyids: ['904ef71e5f4052c81999889545c5d029ceb9623522d0aaa045ee36c8317ad7aa'],
        threshold: 1,
      },
    },
    spec: 1,
    type: 'root',
    version: 1,
  },
}

export const OFFICIAL_WORKSHOP_SITE = 'https://arcadia-eternity.github.io/arcadia-workshop/'
export const OFFICIAL_WORKSHOP_REPOSITORY = 'arcadia-eternity/arcadia-workshop'
