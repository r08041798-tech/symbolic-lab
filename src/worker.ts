const scope = globalThis as unknown as {onmessage:(e:MessageEvent)=>void;postMessage:(v:unknown)=>void};
scope.onmessage=async e=>{try{const {url,input,data}=e.data;const mod=await import(url);scope.postMessage({ok:true,result:await mod.run(input,data)});}catch(error){scope.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}};
