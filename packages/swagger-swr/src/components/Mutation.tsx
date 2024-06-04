import transformers from '@kubb/core/transformers'
import { FunctionParams, URLPath } from '@kubb/core/utils'
import { Parser, File, Function, useApp } from '@kubb/react'
import { pluginTsName } from '@kubb/swagger-ts'
import { pluginZodName } from '@kubb/swagger-zod'
import { useOperation, useOperationManager } from '@kubb/plugin-oas/hooks'
import { getASTParams, getComments } from '@kubb/plugin-oas/utils'

import { SchemaType } from './SchemaType.tsx'

import type { HttpMethod } from '@kubb/oas'
import type { ReactNode } from 'react'
import type { FileMeta, PluginSwr } from '../types.ts'

type TemplateProps = {
  /**
   * Name of the function
   */
  name: string
  /**
   * Parameters/options/props that need to be used
   */
  params: string
  /**
   * Generics that needs to be added for TypeScript
   */
  generics?: string
  /**
   * ReturnType(see async for adding Promise type)
   */
  returnType?: string
  /**
   * Options for JSdocs
   */
  JSDoc?: {
    comments: string[]
  }
  hook: {
    name: string
    generics?: string
  }
  client: {
    method: HttpMethod
    generics: string
    withQueryParams: boolean
    withPathParams: boolean
    withData: boolean
    withHeaders: boolean
    path: URLPath
  }
  dataReturnType: NonNullable<PluginSwr['options']['dataReturnType']>
  requestModelName?: string
  zodRequestName?: string
}

function Template({ name, generics, returnType, params, JSDoc, client, hook, dataReturnType, requestModelName, zodRequestName }: TemplateProps): ReactNode {
  const clientOptions = [
    `method: "${client.method}"`,
    'url',
    client.withQueryParams ? 'params' : undefined,
    client.withData ? 'data' : undefined,
    client.withHeaders ? 'headers: { ...headers, ...clientOptions.headers }' : undefined,
    '...clientOptions',
  ].filter(Boolean)

  const resolvedClientOptions = `${transformers.createIndent(4)}${clientOptions.join(`,\n${transformers.createIndent(4)}`)}`
  
  const mainFunction = client.withQueryParams
      ? <Function export name={name} generics={generics} returnType={returnType} params={params} JSDoc={JSDoc}>
        {`
        const { mutation: mutationOptions, client: clientOptions = {}, shouldFetch = true } = options ?? {}
        const url = ${client.path.template} as const

        return ${hook.name}<${hook.generics}>(
          shouldFetch ? [url, params]: null,
          async (_url${client.withData ? ', { arg: data }' : ''}) => {
            const res = await client<${client.generics}>({
              ${resolvedClientOptions}
            });

            return ${dataReturnType === 'data' ? 'res.data' : 'res'};
          },
          mutationOptions
        );
        `}
      </Function>
      : <Function export name={name} generics={generics} returnType={returnType} params={params} JSDoc={JSDoc}>
        {`
        const { mutation: mutationOptions, client: clientOptions = {}, shouldFetch = true } = options ?? {}
        const url = ${client.path.template} as const

        return ${hook.name}<${hook.generics}>(
          shouldFetch ? url : null,
          async (_url${client.withData ? ', { arg: data }' : ''}) => {
            const res = await client<${client.generics}>({
              ${resolvedClientOptions}
            });

          return ${dataReturnType === 'data' ? 'res.data' : 'res'};
        },
        mutationOptions
      );
      `}
      </Function>;
  
  const formFunctionName = 'useForm' + name.substring(3);
  const formFunctionParams = `...args: Parameters<typeof ${name}>`;
  const formFunctionReturnType = `{
    mutation: ReturnType<typeof ${name}>;
    form: UseFormReturn<${requestModelName}>;
    submitToMutation: ReturnType<UseFormHandleSubmit<${requestModelName}>>
  }`

  return <>
    {mainFunction}

    {zodRequestName && <Function export name={formFunctionName} generics={generics} returnType={formFunctionReturnType} params={formFunctionParams} JSDoc={JSDoc}>
    {`
          const mutation = ${name}(...args);

          function onSubmit(formValue: ${requestModelName}) {
              mutation.trigger(formValue);
          }
      
          const form = useForm<${requestModelName}>({
              resolver: zodResolver(${zodRequestName})
          });
      
          const submitToMutation = form.handleSubmit(onSubmit);

          // Add backend validation error processing here. Should be added as field errors in form
      
          return {
              mutation,
              form,
              submitToMutation
          };

    `}
    </Function>}
  </>
}

const defaultTemplates = {
  default: Template,
} as const

type Props = {
  factory: {
    name: string
  }
  /**
   * This will make it possible to override the default behaviour.
   */
  Template?: React.ComponentType<TemplateProps>
}

export function Mutation({ factory, Template = defaultTemplates.default }: Props): ReactNode {
  const {
    pluginManager,
    plugin: {
      options: { dataReturnType },
    },
  } = useApp<PluginSwr>()
  const { getSchemas, getName } = useOperationManager()
  const operation = useOperation()

  const name = getName(operation, { type: 'function' })
  const schemas = getSchemas(operation)

  const requestModelName = schemas.request?.name ? `${factory.name}["request"]` : ''
  const zodRequestName = schemas.request && pluginManager.resolveName({
    name: schemas.request!.name,
    pluginKey: [pluginZodName],
    type: 'function',
  });

  const params = new FunctionParams()
  const client = {
    method: operation.method,
    path: new URLPath(operation.path),
    generics: [`${factory.name}["data"]`, `${factory.name}["error"]`, requestModelName].filter(Boolean).join(', '),
    withQueryParams: !!schemas.queryParams?.name,
    withData: !!schemas.request?.name,
    withPathParams: !!schemas.pathParams?.name,
    withHeaders: !!schemas.headerParams?.name,
  }

  const keyType = client.withQueryParams ? '[typeof url, typeof params] | null' : 'typeof url | null'

  const resultGenerics = [`${factory.name}["response"]`, `${factory.name}["error"], ${keyType}, ${requestModelName}`]

  params.add([
    ...getASTParams(schemas.pathParams, { typed: true }),
    {
      name: 'params',
      type: `${factory.name}['queryParams']`,
      enabled: client.withQueryParams,
      required: false,
    },
    {
      name: 'headers',
      type: `${factory.name}['headerParams']`,
      enabled: client.withHeaders,
      required: false,
    },
    {
      name: 'options',
      required: false,
      type: `{
        mutation?: SWRMutationConfiguration<${resultGenerics.join(', ')}>,
        client?: ${factory.name}['client']['parameters'],
        shouldFetch?: boolean,
      }`,
      default: '{}',
    },
  ])

  const hook = {
    name: 'useSWRMutation',
    generics: [...resultGenerics].join(', '),
  }

  return (
    <Template
      name={name}
      JSDoc={{ comments: getComments(operation) }}
      client={client}
      hook={hook}
      params={params.toString()}
      returnType={`SWRMutationResponse<${resultGenerics.join(', ')}>`}
      dataReturnType={dataReturnType}
      requestModelName={requestModelName}
      zodRequestName={zodRequestName}
    />
  )
}

type FileProps = {
  /**
   * This will make it possible to override the default behaviour.
   */
  templates?: typeof defaultTemplates
}

Mutation.File = function ({ templates = defaultTemplates }: FileProps): ReactNode {
  const {
    pluginManager,
    plugin: {
      options: {
        client: { importPath },
      },
    },
  } = useApp<PluginSwr>()

  const { getSchemas, getFile, getName } = useOperationManager()
  const operation = useOperation()

  const schemas = getSchemas(operation)
  const file = getFile(operation)
  const fileType = getFile(operation, { pluginKey: [pluginTsName] })
  const fileZodSchemas = getFile(operation, {
    pluginKey: [pluginZodName],
  });
  const zodRequestName = schemas.request && pluginManager.resolveName({
    name: schemas.request!.name,
    pluginKey: [pluginZodName],
    type: 'function',
  });

  const factoryName = getName(operation, { type: 'type' })

  const Template = templates.default
  const factory = {
    name: factoryName,
  }

  return (
    <Parser language="typescript">
      <File<FileMeta> baseName={file.baseName} path={file.path} meta={file.meta}>
        {zodRequestName && <>
          <File.Import name={[zodRequestName]} root={file.path} path={fileZodSchemas.path} />
          <File.Import name={["zodResolver"]} path="@hookform/resolvers/zod" />
          <File.Import name={['UseFormHandleSubmit', 'UseFormReturn', 'useForm']} path="react-hook-form" />
        </>}
        <File.Import name="useSWRMutation" path="swr/mutation" />
        <File.Import name={['SWRMutationConfiguration', 'SWRMutationResponse']} path="swr/mutation" isTypeOnly />
        <File.Import name={'client'} path={importPath} />
        <File.Import name={['ResponseConfig']} path={importPath} isTypeOnly />
        <File.Import
          name={[
            schemas.request?.name,
            schemas.response.name,
            schemas.pathParams?.name,
            schemas.queryParams?.name,
            schemas.headerParams?.name,
            ...(schemas.errors?.map((error) => error.name) || []),
          ].filter(Boolean)}
          root={file.path}
          path={fileType.path}
          isTypeOnly
        />

        <File.Source>
          <SchemaType factory={factory} />
          <Mutation Template={Template} factory={factory} />
        </File.Source>
      </File>
    </Parser>
  )
}

Mutation.templates = defaultTemplates
