// Used in the blog post https://leontrolski.github.io/strongly-typed-http.html
// 
// Not designed as a standalone library (there are probably better options). More
// as a source of inspiration.

import * as express from "express"

const raiseError = (key: string): string => {
    throw new Error(`missing key: ${key} in request`)
}
const safeValues = <Required extends string, NotRequired extends string>(
    item: express.Request["params"] | express.Request["query"] | express.Request["body"],
    required: readonly Required[],
    notRequired: readonly NotRequired[]
): { [K in Required]: string } & { [K in NotRequired]: string | null } => {
    const requiredOut = <{ [K in Required]: string }>{}
    for (const k of required) {
        requiredOut[k] = item[k] === undefined ? raiseError(k) : <string>item[k]
    }
    const notRequiredOut = <{ [k in NotRequired]: string | null }>{}
    for (const k of notRequired) {
        notRequiredOut[k] = item[k] === undefined ? null : <string>item[k]
    }
    return { ...requiredOut, ...notRequiredOut }
}

type DescribeGET = {
    url: string
    params: readonly string[]
    query: readonly string[]
    queryNotRequired: readonly string[]
}
type DescribePOST = {
    url: string
    params: readonly string[]
    body: readonly string[]
}
type ReqGet<
    Params extends readonly string[],
    Query extends readonly string[],
    QueryNotRequired extends readonly string[]
> = (req: express.Request) => {
    params: {
        [K in Params[number]]: string
    }
    query: {
        [K in Query[number]]: string
    } & {
        [K in QueryNotRequired[number]]: string | null
    }
}
type ReqPost<Params extends readonly string[], Body extends readonly string[]> = (
    req: express.Request
) => {
    params: {
        [K in Params[number]]: string
    }
    body: {
        [K in Body[number]]: string
    }
}
type FuncsGET<O extends DescribeGET> = {
    url: O["url"]
    req: ReqGet<O["params"], O["query"], O["queryNotRequired"]>
    makeUrl: (
        params: { [K in O["params"][number]]: string },
        query: { [K in O["query"][number]]: string } & {
            [K in O["queryNotRequired"][number]]?: string
        }
    ) => string
}
type FormParts<O extends DescribePOST> = {
    form: { method: "POST"; action: string }
    inputs: { [K in O["body"][number]]: { name: K } }
    assertAllInputsReferenced: () => null
}
type FuncsPOST<O extends DescribePOST> = {
    url: O["url"]
    req: ReqPost<O["params"], O["body"]>
    makeForm: (params: { [K in O["params"][number]]: string }) => FormParts<O>
}

const makeGetFuncs = <O extends DescribeGET>(o: O): FuncsGET<O> => {
    const makeUrl = (
        params: { [K in O["params"][number]]: string },
        query: { [K in O["query"][number]]: string } & {
            [K in O["queryNotRequired"][number]]?: string
        }
    ): string => {
        let url = o.url
        for (const k in params) {
            if (!url.includes(":" + k)) throw new Error(`url missing param ${k}`)
            url = url.replace(":" + k, encodeURIComponent(params[<O["params"][number]>k]))
        }
        if (!Object.keys(query).length) return url
        return url + "?" + new URLSearchParams(query).toString()
    }

    return {
        url: o.url,
        req: (req: express.Request) => ({
            params: safeValues<O["params"][number], never>(req.params, o.params, []),
            query: safeValues<O["query"][number], O["queryNotRequired"][number]>(
                req.query,
                o.query,
                o.queryNotRequired
            ),
        }),
        makeUrl,
    }
}
const makePostFuncs = <O extends DescribePOST>(o: O): FuncsPOST<O> => {
    const makeForm = (params: { [K in O["params"][number]]: string }): FormParts<O> => {
        let url = o.url
        for (const k in params) {
            if (!url.includes(":" + k)) throw new Error(`url missing param ${k}`)
            url = url.replace(":" + k, encodeURIComponent(params[<O["params"][number]>k]))
        }
        // make a map of {name: true|false} to say if we've "used" an input
        const inputUsedMap = <{ [K in O["body"][number]]: boolean }>(
            (<unknown>Object.fromEntries(o.body.map((b) => [b, false])))
        )
        // the Proxy registers when an input was referenced
        const proxyHandler = {
            get: (_: any, k: O["body"][number]) => {
                inputUsedMap[k] = true
                return { name: k }
            },
        }
        const inputs = <{ [K in O["body"][number]]: { name: K } }>new Proxy({}, proxyHandler)

        const assertAllInputsReferenced = (): null => {
            if (Object.values(inputUsedMap).every((x) => x)) return null
            const naffKeys = Object.entries(inputUsedMap)
                .filter(([k, v]) => !v)
                .map(([k, v]) => k)
            throw new Error(
                `the following body keys were never referred to: ${naffKeys.join(", ")}`
            )
        }
        return { form: { method: "POST", action: url }, inputs, assertAllInputsReferenced }
    }

    return {
        url: o.url,
        req: (req: express.Request) => ({
            params: safeValues<O["params"][number], never>(req.params, o.params, []),
            body: safeValues<O["body"][number], never>(req.body, o.body, []),
        }),
        makeForm,
    }
}

export const makeGET = <M extends { [K: string]: DescribeGET }>(
    m: M
): { [Url in keyof M]: FuncsGET<M[Url]> } => {
    return <any>Object.fromEntries(Object.entries(m).map(([k, v]) => [k, makeGetFuncs(v)]))
}
export const makePOST = <M extends { [K: string]: DescribePOST }>(
    m: M
): { [Url in keyof M]: FuncsPOST<M[Url]> } => {
    return <any>Object.fromEntries(Object.entries(m).map(([k, v]) => [k, makePostFuncs(v)]))
}
