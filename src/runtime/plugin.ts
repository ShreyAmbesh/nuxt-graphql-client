import { defu } from 'defu'
import type { Ref } from 'vue'
import { GraphQLClient } from 'graphql-request'
import type { GqlState, GqlConfig } from '../types'
import { ref, useCookie, useNuxtApp, defineNuxtPlugin, useRuntimeConfig, useRequestHeaders } from '#imports'
import type { GqlClients } from '#gql'

export default defineNuxtPlugin((nuxtApp) => {
  // const nuxtApp = useNuxtApp() as Partial<{ _gqlState: Ref<GqlState> }> & ReturnType<typeof useNuxtApp>

  if (!nuxtApp?._gqlState) {
    nuxtApp._gqlState = ref({})

    const config = useRuntimeConfig()

    const { clients }: GqlConfig = defu(config?.['graphql-client'], config?.public?.['graphql-client'])

    const cookie = (process.server && useRequestHeaders(['cookie'])?.cookie) || undefined

    for (const [name, v] of Object.entries(clients)) {
      const host = (process.client && v?.clientHost) || v.host

      const proxyCookie = v?.proxyCookies && !!cookie

      const serverHeaders = (process.server && (typeof v?.headers?.serverOnly === 'object' && v?.headers?.serverOnly)) || undefined
      if (v?.headers?.serverOnly) { delete v.headers.serverOnly }

      const opts = {
        ...((proxyCookie || v?.token?.value || v?.headers) && {
          headers: {
            ...(v?.headers && { ...(v.headers as Record<string, string>), ...serverHeaders }),
            ...(proxyCookie && { cookie })
          }
        })
      }

      nuxtApp._gqlState.value[name] = {
        options: opts,
        instance: new GraphQLClient(host, {
          ...(v?.preferGETQueries && {
            method: 'GET',
            jsonSerializer: { parse: JSON.parse, stringify: JSON.stringify }
          }),
          requestMiddleware: async (req) => {
            const token = ref<string>()
            await nuxtApp.callHook('gql:auth:init', { token, client: name as GqlClients })

            const reqOpts = defu(nuxtApp._gqlState.value?.[name]?.options || {}, { headers: {} })

            token.value ??= reqOpts?.token?.value

            if (!token.value && typeof v.tokenStorage === 'object') {
              if (v.tokenStorage?.mode === 'cookie') {
                if (process.client) {
                  token.value = useCookie(v.tokenStorage.name).value
                } else if (cookie) {
                  const cookieName = `${v.tokenStorage.name}=`
                  token.value = cookie.split(';').find(c => c.trim().startsWith(cookieName))?.split('=')?.[1]
                }
              } else if (process.client && v.tokenStorage?.mode === 'localStorage') {
                token.value = localStorage.getItem(v.tokenStorage.name)
              }
            }

            token.value ??= v?.token?.value

            if (token.value) {
              token.value = token.value.trim()

              const tokenName = token.value === reqOpts?.token?.value ? reqOpts?.token?.name || v?.token?.name : v?.token?.name
              const tokenType = token.value === reqOpts?.token?.value ? reqOpts?.token?.type === null ? null : reqOpts?.token?.type || v?.token?.type : v?.token?.type

              const authScheme = !!token.value?.match(/^[a-zA-Z]+\s/)?.[0]

              if (authScheme) {
                reqOpts.headers[tokenName] = token.value
              } else {
                reqOpts.headers[tokenName] = !tokenType ? token.value : `${tokenType} ${token.value}`
              }
            }

            if (reqOpts?.token) { delete reqOpts.token }
            return defu<RequestInit, [RequestInit]>(req, reqOpts)
          }
        })
      }
    }
  }
})

declare module '#app' {
  interface RuntimeNuxtHooks {
    /**
     * `gql:auth:init` hook specifies how the authentication token is retrieved.
     */
    'gql:auth:init': (params: { client: GqlClients, token: Ref<string> }) => void
  }
}
