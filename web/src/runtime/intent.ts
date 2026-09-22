/** Cancellation and commit permission belong to the user's latest intention. */
export class IntentScope {
 private generation=0;
 private controller:AbortController|null=null;
 start(){this.cancel();const generation=this.generation,controller=new AbortController();this.controller=controller;return {signal:controller.signal,current:()=>this.generation===generation&&!controller.signal.aborted};}
 cancel(){this.generation++;this.controller?.abort();this.controller=null;}
}
