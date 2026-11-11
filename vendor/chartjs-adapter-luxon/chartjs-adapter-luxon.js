import{_adapters as o}from"chart.js";import{DateTime as i}from"luxon";var s={datetime:i.DATETIME_MED_WITH_SECONDS,millisecond:"h:mm:ss.SSS a",second:i.TIME_WITH_SECONDS,minute:i.TIME_SIMPLE,hour:{hour:"numeric"},day:{day:"numeric",month:"short"},week:"DD",month:{month:"short",year:"numeric"},quarter:"'Q'q - yyyy",year:{year:"numeric"}};o._date.override({_id:"luxon",_create:function(t){return i.fromMillis(t,this.options)},init(t){this.options.locale||(this.options.locale=t.locale)},formats:function(){return s},parse:function(t,e){let n=this.options,r=typeof t;return t===null||r==="undefined"?null:(r==="number"?t=this._create(t):r==="string"?typeof e=="string"?t=i.fromFormat(t,e,n):t=i.fromISO(t,n):t instanceof Date?t=i.fromJSDate(t,n):r==="object"&&!(t instanceof i)&&(t=i.fromObject(t,n)),t.isValid?t.valueOf():null)},format:function(t,e){let n=this._create(t);return typeof e=="string"?n.toFormat(e):n.toLocaleString(e)},add:function(t,e,n){let r={};return r[n]=e,this._create(t).plus(r).valueOf()},diff:function(t,e,n){return this._create(t).diff(this._create(e)).as(n).valueOf()},startOf:function(t,e,n){if(e==="isoWeek"){n=Math.trunc(Math.min(Math.max(0,n),6));let r=this._create(t);return r.minus({days:(r.weekday-n+7)%7}).startOf("day").valueOf()}return e?this._create(t).startOf(e).valueOf():t},endOf:function(t,e){return this._create(t).endOf(e).valueOf()}});
/*! Bundled license information:

chartjs-adapter-luxon/dist/chartjs-adapter-luxon.esm.js:
  (*!
   * chartjs-adapter-luxon v1.3.1
   * https://www.chartjs.org
   * (c) 2023 chartjs-adapter-luxon Contributors
   * Released under the MIT license
   *)
*/
