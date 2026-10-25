// Clopper-Pearson exact interval via beta quantile bisection.
function lbeta(a,b){return lg(a)+lg(b)-lg(a+b)}
function lg(x){const c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];let y=x,t=x+5.5;t-=(x+0.5)*Math.log(t);let s=1.000000000190015;for(const k of c)s+=k/++y;return -t+Math.log(2.5066282746310005*s/x)}
function ibeta(x,a,b){if(x<=0)return 0;if(x>=1)return 1;const bt=Math.exp(a*Math.log(x)+b*Math.log(1-x)-lbeta(a,b));if(x<(a+1)/(a+b+2))return bt*cf(x,a,b)/a;return 1-bt*cf(1-x,b,a)/b}
function cf(x,a,b){let qab=a+b,qap=a+1,qam=a-1,c=1,d=1-qab*x/qap;d=1/d;let h=d;for(let m=1;m<200;m++){let m2=2*m,aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;d=1/d;c=1+aa/c;h*=d*c;aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;d=1/d;c=1+aa/c;const del=d*c;h*=del;if(Math.abs(del-1)<1e-12)break}return h}
function q(p,a,b){let lo=0,hi=1;for(let i=0;i<100;i++){const m=(lo+hi)/2;if(ibeta(m,a,b)<p)lo=m;else hi=m}return lo}
function cp(k,n){return [k===0?0:q(0.025,k,n-k+1),k===n?1:q(0.975,k+1,n-k)].map(v=>(v*100).toFixed(1))}
for (const [k,n] of process.argv.slice(2).map(s=>s.split("/").map(Number))) console.log(`${k}/${n} = ${(100*k/n).toFixed(1)}%  CI ${cp(k,n).join("-")}`);
