import { useApp } from '@kubb/react-template'

import type { Operation } from '@kubb/swagger'
import type { AppMeta } from '../types.ts'

export function useOperation(): Operation {
  const { meta } = useApp<AppMeta>()

  return meta.operation
}
