const LEGACY_STORAGE_KEYS = ['billwise-bills-v1','billwise-paid-v1','billwise-monthly-records-v1','billwise-history-imported-v1','billwise-history-import-version-v1'];
const HISTORY_IMPORT_VERSION = 7;
const colors = {
  Housing: ['#f5eee7', '#94775b', '⌂'],
  Utilities: ['#edf2fa', '#627da7', 'ϟ'],
  Subscriptions: ['#f3eef8', '#927aab', '◉'],
  Insurance: ['#edf4f1', '#5f8b76', '◇'],
  Transportation: ['#faf0e9', '#b47a55', '↗'],
  Other: ['#f1f2ed', '#77836f', '•']
};
const starterBills = [
  {id:'rent',name:'Rent',amount:1850,dueDay:1,category:'Housing',note:'Apartment lease'},
  {id:'electric',name:'Electric bill',amount:86.42,dueDay:5,category:'Utilities',note:'City Power & Light'},
  {id:'internet',name:'Internet',amount:65,dueDay:8,category:'Utilities',note:'Fiber connection'},
  {id:'phone',name:'Phone plan',amount:48,dueDay:12,category:'Utilities',note:'Family plan'},
  {id:'streaming',name:'Streaming bundle',amount:24.99,dueDay:16,category:'Subscriptions',note:'Entertainment'},
  {id:'car',name:'Car insurance',amount:142.5,dueDay:20,category:'Insurance',note:'Auto policy'},
  {id:'water',name:'Water & trash',amount:58.75,dueDay:24,category:'Utilities',note:'Quarterly adjustment may apply'}
];
let bills = starterBills;
let paid = {};
let monthlyRecords = {};
let historyImported = false;
let historyImportVersion = 0;
let dueNotices = {};
let dueNoticeTimer;
let localDatabase=null;
let shownMonth = new Date(); shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), 1);
let activeFilter = 'all';
let activeView = 'calendar';
let toastTimer;
const $ = id => document.getElementById(id);
const currency = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
function readLegacyState(){try{const read=key=>{const value=localStorage.getItem(key);return value?JSON.parse(value):null};return{bills:read(LEGACY_STORAGE_KEYS[0]),paid:read(LEGACY_STORAGE_KEYS[1]),monthlyRecords:read(LEGACY_STORAGE_KEYS[2]),historyImported:read(LEGACY_STORAGE_KEYS[3]),historyImportVersion:read(LEGACY_STORAGE_KEYS[4])}}catch(error){console.warn('Could not read existing browser data for migration.',error);return null}}
function clearLegacyState(){try{for(const key of LEGACY_STORAGE_KEYS)localStorage.removeItem(key)}catch(error){console.warn('Could not clear migrated browser data.',error)}}
function writeDatabase(){if(!localDatabase)return Promise.reject(new Error('Local database is unavailable'));return new Promise((resolve,reject)=>{const transaction=localDatabase.transaction('appState','readwrite');transaction.objectStore('appState').put({bills,paid,monthlyRecords,historyImported,historyImportVersion,dueNotices,updatedAt:new Date().toISOString()},'current');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Database write aborted'))})}
function save(){if(localDatabase)writeDatabase().catch(error=>console.warn('Could not save to the local database.',error))}
function openLocalDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open('BillwiseLocalData',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('appState'))request.result.createObjectStore('appState')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function readDatabaseState(){return new Promise((resolve,reject)=>{const transaction=localDatabase.transaction('appState','readonly');const request=transaction.objectStore('appState').get('current');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)})}
async function initializeLocalDatabase(){
  let importedNow=false;
  let paidDatesFilled=0;
  let futureDatesCleared=0;
  let dueDatesSetToFirst=0;
  let futureDueDatesUpdated=false;
  try{
    if('indexedDB'in window){
      localDatabase=await openLocalDatabase();
      let savedState=await readDatabaseState();
      if(!savedState){
        const legacy=readLegacyState();
        if(legacy?.bills){
          const isStarterSet=Array.isArray(legacy.bills)&&legacy.bills.length===starterBills.length&&legacy.bills.every(saved=>starterBills.some(seed=>saved.id===seed.id&&saved.name===seed.name));
          savedState={bills:isStarterSet?starterBills:legacy.bills,paid:legacy.paid||{},monthlyRecords:legacy.monthlyRecords||{},historyImported:Boolean(legacy.historyImported),historyImportVersion:Number(legacy.historyImportVersion||0)};
        }else savedState={bills:starterBills,paid:{},monthlyRecords:{},historyImported:false,historyImportVersion:0};
        bills=savedState.bills;paid=savedState.paid;monthlyRecords=savedState.monthlyRecords;historyImported=savedState.historyImported;historyImportVersion=savedState.historyImportVersion;
        await writeDatabase();
        clearLegacyState();
        savedState=await readDatabaseState();
      }
      if(savedState&&Array.isArray(savedState.bills)){
        bills=savedState.bills;
        paid=savedState.paid||{};
        monthlyRecords=savedState.monthlyRecords||monthlyRecords;
        historyImported=Boolean(savedState.historyImported||historyImported);
        historyImportVersion=Number(savedState.historyImportVersion||historyImportVersion);
        dueNotices=savedState.dueNotices||{};
      }
      clearLegacyState();
    }else throw new Error('IndexedDB is not supported');
  }catch(error){console.error('Could not open the local database.',error);showToast('Could not open local data. Please restart the app.');return}
  if(!historyImported&&window.BILLWISE_HISTORY){
    for(const [month,records] of Object.entries(window.BILLWISE_HISTORY)){
      if(!Object.prototype.hasOwnProperty.call(monthlyRecords,month)){
        monthlyRecords[month]=records.map(record=>{
          const template=bills.find(bill=>bill.id===record.id);
          const amounts=template?.monthlyAmounts||{};
          return Object.prototype.hasOwnProperty.call(amounts,month)?{...record,amount:amounts[month]}:record;
        });
      }
    }
    historyImported=true;
    importedNow=true;
  }
  if(historyImportVersion<HISTORY_IMPORT_VERSION){
    const migration=backfillMissingPaidDates();
    paidDatesFilled=migration.filled;
    futureDatesCleared=migration.reverted;
    dueDatesSetToFirst=migration.dueDatesSetToFirst;
    setFutureDueDateDefaults();
    futureDueDatesUpdated=true;
    historyImportVersion=HISTORY_IMPORT_VERSION;
    importedNow=true;
    save();
  }else if(!historyImported){
    save();
  }else{
    save();
  }
  render();
  if(importedNow){
    const updates=[];
    if(paidDatesFilled)updates.push(`${paidDatesFilled} past bills marked paid on their due dates`);
    if(dueDatesSetToFirst)updates.push(`${dueDatesSetToFirst} missing due dates set to the 1st`);
    if(futureDatesCleared)updates.push('future bills left unpaid');
    if(futureDueDatesUpdated)updates.push('future Citi and Renters due dates updated');
    showToast(updates.join('; ')||'Bill history imported: May 2017–December 2026');
  }
  checkDueNotices();
  scheduleDueNoticeCheck();
}
function monthKey(date=shownMonth){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`}
function dueDateValue(month,record){if(record.dueOn&&/^\d{4}-\d{2}-\d{2}$/.test(record.dueOn))return record.dueOn;const period=month.split('-').map(Number);let day=record.dueDay;let year=period[0],monthNumber=period[1];const label=String(record.dueLabel||'').match(/^(\d{1,2})-([A-Za-z]{3})$/);if(label){day=Number(label[1]);const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const labelMonth=months.indexOf(label[2][0].toUpperCase()+label[2].slice(1,3));if(labelMonth>=0){monthNumber=labelMonth+1;if(monthNumber-period[1]>6)year--;else if(period[1]-monthNumber>6)year++}}if(!day||day<1||monthNumber<1)return null;const lastDay=new Date(year,monthNumber,0).getDate();day=Math.min(day,lastDay);return `${year}-${String(monthNumber).padStart(2,'0')}-${String(day).padStart(2,'0')}`}
function backfillMissingPaidDates(){
  let filled=0,reverted=0,dueDatesSetToFirst=0;
  const today=new Date();
  const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  for(const [month,records] of Object.entries(monthlyRecords)){
    for(const record of records){
      let dueDate=dueDateValue(month,record);
      if(record.paidDateGenerated&&dueDate&&dueDate>=todayKey){
        if(record.paidOn===dueDate)delete record.paidOn;
        delete record.dueOn;
        delete record.paidDateGenerated;
        record.sourcePaid=['y','yes','paid'].includes(String(record.sourceStatus||'').toLowerCase());
        const oldPayment=paid[month]?.[record.id];
        if(oldPayment&&typeof oldPayment==='object'&&oldPayment.paidOn===dueDate)delete paid[month][record.id];
        reverted++;
        continue;
      }
      if(!record.dueDay){
        const firstOfMonth=`${month}-01`;
        if(firstOfMonth>=todayKey)continue;
        const [year,monthNumber]=month.split('-').map(Number);
        record.dueDay=1;
        record.dueLabel=`1-${new Intl.DateTimeFormat('en-US',{month:'short'}).format(new Date(year,monthNumber-1,1))}`;
        record.dueOn=firstOfMonth;
        dueDate=firstOfMonth;
        dueDatesSetToFirst++;
      }
      const previous=paid[month]?.[record.id];
      const previousDate=previous&&typeof previous==='object'?previous.paidOn:'';
      if(record.paidOn||previousDate){
        if(!record.paidOn)record.paidOn=previousDate;
        record.sourcePaid=true;
        paid[month]??={};
        paid[month][record.id]={paid:true,paidOn:record.paidOn};
        continue;
      }
      if(!dueDate||dueDate>=todayKey)continue;
      record.dueOn=dueDate;
      record.paidOn=dueDate;
      record.paidDateGenerated=true;
      record.sourcePaid=true;
      paid[month]??={};
      paid[month][record.id]={paid:true,paidOn:dueDate};
      filled++;
    }
  }
  return{filled,reverted,dueDatesSetToFirst};
}
function setFutureDueDateDefaults(){
  const now=new Date();
  const currentMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const recologyAnchor=2026*12+11;
  for(const [month,records] of Object.entries(monthlyRecords)){
    if(month<=currentMonth)continue;
    const [year,monthNumber]=month.split('-').map(Number);
    const monthName=new Intl.DateTimeFormat('en-US',{month:'short'}).format(new Date(year,monthNumber-1,1));
    const monthIndex=year*12+(monthNumber-1);
    const recologyDue=monthIndex>=recologyAnchor&&(monthIndex-recologyAnchor)%3===0;
    monthlyRecords[month]=records.filter(record=>record.id!=='recology'||recologyDue);
    for(const record of monthlyRecords[month]){
      let dueDay=null;
      if(record.id==='citi')dueDay=15;
      else if(record.id==='renters'||record.id==='car-payment')dueDay=1;
      else if(record.id==='recology')dueDay=25;
      if(dueDay===null)continue;
      record.dueDay=dueDay;
      record.dueLabel=`${dueDay}-${monthName}`;
    }
  }
  const citi=bills.find(bill=>bill.id==='citi');
  const renters=bills.find(bill=>bill.id==='renters');
  const carPayment=bills.find(bill=>bill.id==='car-payment');
  const recology=bills.find(bill=>bill.id==='recology');
  if(citi)citi.dueDay=15;
  if(renters)renters.dueDay=1;
  if(carPayment)carPayment.dueDay=1;
  if(recology){recology.dueDay=25;recology.intervalMonths=3;recology.nextDueMonth='2026-12'}
}
function monthBillsFor(month){if(Object.prototype.hasOwnProperty.call(monthlyRecords,month))return monthlyRecords[month].map(record=>({...bills.find(bill=>bill.id===record.id),...record,historicalRecord:true}));return bills.filter(bill=>occursInMonth(bill,month)).map(bill=>({...bill,historicalRecord:false}))}
function monthBills(){return monthBillsFor(monthKey())}
function occursInMonth(bill,month){if(!bill.intervalMonths||!bill.nextDueMonth)return true;const [year,monthNumber]=month.split('-').map(Number);const [anchorYear,anchorMonth]=bill.nextDueMonth.split('-').map(Number);const offset=(year-anchorYear)*12+(monthNumber-anchorMonth);return offset>=0&&offset%bill.intervalMonths===0}
function isPaidForMonth(bill,month){const monthPaid=paid[month]||{};if(Object.prototype.hasOwnProperty.call(monthPaid,bill.id)){const value=monthPaid[bill.id];return typeof value==='object'&&value!==null&&Object.prototype.hasOwnProperty.call(value,'paid')?Boolean(value.paid):Boolean(value)}return Boolean(bill.sourcePaid)}
function isPaid(bill){return isPaidForMonth(bill,monthKey())}
function amountFor(bill){if(bill.historicalRecord&&Object.prototype.hasOwnProperty.call(bill,'amount'))return bill.amount;const monthly=bill.monthlyAmounts||{};return Object.prototype.hasOwnProperty.call(monthly,monthKey())?monthly[monthKey()]:bill.amount}
function paidOnFor(bill){const stored=paid[monthKey()]?.[bill.id];if(stored!==undefined){if(typeof stored==='object'&&stored!==null)return stored.paidOn||'';if(typeof stored==='string')return stored}return bill.paidOn||bill.paidOnRaw||''}
function formatPaidOn(value){if(!value)return '—';if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const [year,month,day]=value.split('-').map(Number);return `${day}-${new Intl.DateTimeFormat('en-US',{month:'short'}).format(new Date(year,month-1,day))}`}
function formatAmount(amount){return amount===null||amount===undefined?'—':currency(Number(amount))}
function formatMonth(date){return new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'}).format(date)}
function render(){
  const month=monthKey(), today=new Date(), currentMonth=monthKey(new Date(today.getFullYear(),today.getMonth(),1));
  const currentBills=monthBills();
  $('month-picker').value=month;
  $('today-label').textContent=new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric'}).format(today);
  const total=currentBills.reduce((sum,b)=>sum+(Number(amountFor(b))||0),0), paidBills=currentBills.filter(isPaid), paidTotal=paidBills.reduce((sum,b)=>sum+(Number(amountFor(b))||0),0), unpaid=currentBills.filter(b=>!isPaid(b));
  $('total-amount').textContent=currency(total);$('paid-amount').textContent=currency(paidTotal);$('remaining-amount').textContent=currency(total-paidTotal);
  $('total-count').textContent=`${currentBills.length} ${currentBills.length===1?'bill':'bills'}`;$('remaining-count').textContent=`${unpaid.length} ${unpaid.length===1?'bill':'bills'}`;
  const percentage=total?Math.round(paidTotal/total*100):0;$('progress-fill').style.width=`${percentage}%`;$('progress-label').textContent=`${percentage}% of total`;
  $('bill-number').textContent=currentBills.length;$('sidebar-count').textContent=currentBills.length;$('all-count').textContent=currentBills.length;$('unpaid-count').textContent=unpaid.length;$('paid-count').textContent=paidBills.length;
  const next=unpaid.filter(b=>b.dueDay).slice().sort((a,b)=>a.dueDay-b.dueDay)[0];
  if(!next){$('next-due').textContent=unpaid.length?'No due date':currentBills.length?'All caught up':'No bills yet';$('next-due-name').textContent=unpaid.length?`${unpaid.length} ${unpaid.length===1?'bill needs':'bills need'} a due date`:currentBills.length?'Every bill is paid this month':'Add a bill to get started'}
  else {const date=dueDate(next);const diff=Math.ceil((new Date(date.getFullYear(),date.getMonth(),date.getDate())-new Date(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);let label=diff===0?'Today':diff===1?'Tomorrow':diff<0?`${Math.abs(diff)}d overdue`:`In ${diff} days`;if(month!==currentMonth)label=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(date);$('next-due').textContent=label;$('next-due-name').textContent=next.name}
  let visible=currentBills.filter(b=>activeFilter==='all'||(activeFilter==='paid'?isPaid(b):!isPaid(b))).filter(b=>`${b.name} ${b.category} ${b.note||''}`.toLowerCase().includes($('search-input').value.trim().toLowerCase())).sort((a,b)=>(a.dueDay||99)-(b.dueDay||99));
  $('bill-list').innerHTML=visible.map(billRow).join('');$('empty-state').classList.toggle('hidden',visible.length>0);$('bill-list').classList.toggle('hidden',activeView!=='list'||visible.length===0);$('bill-list-head').classList.toggle('hidden',activeView!=='list'||visible.length===0);
  $('calendar-grid').innerHTML=calendarCells(visible);$('calendar-view').classList.toggle('hidden',activeView!=='calendar'||visible.length===0);
  const visibleUnscheduled=visible.filter(bill=>!bill.dueDay);
  $('unscheduled-section').classList.toggle('hidden',activeView!=='calendar'||visibleUnscheduled.length===0);
  $('unscheduled-count').textContent=visibleUnscheduled.length;
  $('unscheduled-list').innerHTML=visibleUnscheduled.map(bill=>`<button class="unscheduled-bill ${isPaid(bill)?'settled':''}" data-action="toggle" data-id="${bill.id}"><span class="unscheduled-name"><strong>${escapeHTML(bill.name)}</strong><small>Due date not set</small></span><span class="unscheduled-amount">${formatAmount(amountFor(bill))}</span><span class="unscheduled-status">${isPaid(bill)?'✓ Paid':'Mark paid'}</span></button>`).join('');
  $('list-footer-text').textContent=`Showing ${visible.length} of ${currentBills.length} ${currentBills.length===1?'bill':'bills'}`;
}
function dueDate(b){const lastDay=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,0).getDate();return new Date(shownMonth.getFullYear(),shownMonth.getMonth(),Math.min(b.dueDay,lastDay))}
function calendarCells(visible){const firstDay=new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1).getDay();const daysInMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,0).getDate();const today=new Date();const isCurrent=monthKey()===monthKey(new Date(today.getFullYear(),today.getMonth(),1));const cells=[];for(let i=0;i<firstDay;i++)cells.push('<div class="calendar-day outside" role="gridcell" aria-hidden="true"></div>');for(let day=1;day<=daysInMonth;day++){const dayBills=visible.filter(b=>b.dueDay&&dueDate(b).getDate()===day);const isToday=isCurrent&&today.getDate()===day;const todayClass=isToday?' today':'';const chips=dayBills.map(b=>`<button class="calendar-bill ${isPaid(b)?'settled':''}" data-action="toggle" data-id="${b.id}" title="${escapeHTML(b.name)} · ${formatAmount(amountFor(b))} · ${isPaid(b)?'Paid':'To pay'}"><span>${escapeHTML(b.name)}</span><strong>${formatAmount(amountFor(b))}</strong></button>`).join('');cells.push(`<div class="calendar-day${todayClass}" role="gridcell"${isToday?' aria-label="Today"':''}><div class="calendar-day-heading"><span class="calendar-date">${day}</span>${isToday?'<span class="current-day-label">Today</span>':''}</div>${chips}</div>`)}const remainder=(7-(cells.length%7))%7;for(let i=0;i<remainder;i++)cells.push('<div class="calendar-day outside" role="gridcell" aria-hidden="true"></div>');return cells.join('')}
function billRow(b){const [bg,fg,icon]=colors[b.category]||colors.Other;const done=isPaid(b);const due=b.dueDay?dueDate(b):null;const now=new Date();const delta=due?Math.ceil((new Date(due.getFullYear(),due.getMonth(),due.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000):null;const dueText=b.dueLabel||(due?`${due.getDate()}-${new Intl.DateTimeFormat('en-US',{month:'short'}).format(due)}`:'—');let dueClass='';if(due&&monthKey()===monthKey(new Date(now.getFullYear(),now.getMonth(),1))){if(delta<0&&!done)dueClass='late';else if(delta<=1&&!done)dueClass='urgent'}const sourceTitle=b.sourceStatus?` title="Source status: ${escapeHTML(b.sourceStatus)}"`:'';const paidDateTitle=b.paidDateGenerated?' title="Filled using the due date"':'';return `<article class="bill-row"><div class="bill-name-cell"><span class="bill-symbol" style="background:${bg};color:${fg}">${icon}</span><div><strong>${escapeHTML(b.name)}</strong><small>${escapeHTML(b.note||b.category)}</small></div></div><span class="bill-due ${dueClass}">${escapeHTML(dueText)}</span><span class="paid-date"${paidDateTitle}>${formatPaidOn(paidOnFor(b))}</span><span class="bill-amount">${formatAmount(amountFor(b))}</span><button class="status-btn ${done?'is-paid':''}" data-action="toggle" data-id="${b.id}"${sourceTitle}>${done?'✓ Paid':'Mark paid'}</button><button class="row-menu" data-action="edit" data-id="${b.id}" aria-label="Edit ${escapeHTML(b.name)}">✎</button></article>`}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function showToast(message){const toast=$('toast');toast.textContent=message;toast.classList.remove('due-notice');toast.setAttribute('role','status');toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2200)}
function showDueNotice(message){const toast=$('toast');toast.textContent=message;toast.setAttribute('role','alert');toast.classList.add('show','due-notice');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.classList.remove('show','due-notice');toast.setAttribute('role','status')},8000)}
function checkDueNotices(){
  if(!localDatabase)return;
  const now=new Date();
  const todayKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const currentMonth=monthKey(new Date(now.getFullYear(),now.getMonth(),1));
  const dueToday=monthBillsFor(currentMonth).filter(bill=>dueDateValue(currentMonth,bill)===todayKey&&!isPaidForMonth(bill,currentMonth));
  const unseen=dueToday.filter(bill=>!dueNotices[`${todayKey}:${bill.id}`]);
  if(!unseen.length)return;
  unseen.forEach(bill=>{dueNotices[`${todayKey}:${bill.id}`]=true});
  save();
  const names=unseen.map(bill=>bill.name);
  const summary=names.length<=3?names.join(', '):`${names.slice(0,3).join(', ')} and ${names.length-3} more`;
  window.billwiseNotifications?.notifyDueBills({names});
  showDueNotice(`${names.length} ${names.length===1?'bill is':'bills are'} due today: ${summary}`);
}
function scheduleDueNoticeCheck(){
  clearTimeout(dueNoticeTimer);
  const now=new Date();
  const nextCheck=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,1);
  dueNoticeTimer=setTimeout(()=>{checkDueNotices();scheduleDueNoticeCheck()},nextCheck.getTime()-now.getTime());
}
window.addEventListener('focus',checkDueNotices);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDueNotices()});
function openDialog(bill){const form=$('bill-form');form.reset();$('dialog-title').textContent=bill?'Edit bill':'Add a bill';$('save-bill').innerHTML=bill?'Save changes <span>→</span>':'Save bill <span>→</span>';form.dataset.editId=bill?.id||'';$('delete-bill').classList.toggle('hidden',!bill);if(bill){$('bill-name').value=bill.name;$('bill-amount').value=amountFor(bill)??'';$('bill-due').value=bill.dueDay??'';$('bill-category').value=bill.category;$('bill-note').value=bill.note||''}$('bill-dialog').showModal();setTimeout(()=>$('bill-name').focus(),50)}
for(let day=0;day<=31;day++)$('bill-due').insertAdjacentHTML('beforeend',day===0?'<option value="">No due date</option>':`<option value="${day}">${day}${day===1?'st':day===2?'nd':day===3?'rd':'th'} of the month</option>`);
$('add-bill-btn').addEventListener('click',()=>openDialog());$('empty-add').addEventListener('click',()=>openDialog());$('close-dialog').addEventListener('click',()=>$('bill-dialog').close());$('cancel-dialog').addEventListener('click',()=>$('bill-dialog').close());
$('bill-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);const editId=event.currentTarget.dataset.editId;const rawAmount=data.get('amount');const amount=rawAmount===''?null:Number(rawAmount);const bill={id:editId||`${Date.now()}-${Math.random().toString(16).slice(2,7)}`,name:data.get('name').trim(),amount,dueDay:data.get('dueDay')?Number(data.get('dueDay')):null,dueLabel:data.get('dueDay')?`${data.get('dueDay')}-${new Intl.DateTimeFormat('en-US',{month:'short'}).format(shownMonth)}`:null,category:data.get('category'),note:data.get('note').trim()};const key=monthKey();if(editId){const original=monthBills().find(item=>item.id===editId);if(original?.historicalRecord){monthlyRecords[key]=monthlyRecords[key].map(record=>record.id===editId?{...record,...bill,sourcePaid:record.sourcePaid,paidOn:record.paidOn,sourceStatus:record.sourceStatus,reference:record.reference}:record)}else{const template=bills.find(item=>item.id===editId);bill.amount=template.amount;bill.monthlyAmounts={...(template.monthlyAmounts||{}),[key]:amount};bills=bills.map(item=>item.id===editId?bill:item)}}else{bills.push(bill);if(Object.prototype.hasOwnProperty.call(monthlyRecords,key))monthlyRecords[key].push({...bill,sourcePaid:false,paidOn:null,sourceStatus:null,reference:null})}save();render();$('bill-dialog').close();showToast(editId?`Amount saved for ${formatMonth(shownMonth)}`:'Bill added to your monthly list')});
$('bills').addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const bill=monthBills().find(item=>item.id===button.dataset.id);if(!bill)return;if(button.dataset.action==='toggle'){paid[monthKey()]??={};const markPaid=!isPaid(bill);const now=new Date();const paidDate=markPaid?`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`:'';paid[monthKey()][bill.id]={paid:markPaid,paidOn:paidDate};if(bill.historicalRecord){const record=monthlyRecords[monthKey()].find(item=>item.id===bill.id);if(record){delete record.paidDateGenerated;if(markPaid){record.paidOn=paidDate;record.sourcePaid=true}else{delete record.paidOn;record.sourcePaid=false}}}save();render();showToast(markPaid?`${bill.name} marked paid`:`${bill.name} marked unpaid`)}else if(button.dataset.action==='edit'){openDialog(bill)}});
$('delete-bill').addEventListener('click',()=>{const id=$('bill-form').dataset.editId;const bill=monthBills().find(item=>item.id===id);if(!bill)return;if(confirm(`Remove ${bill.name} from this month?`)){if(bill.historicalRecord)monthlyRecords[monthKey()]=monthlyRecords[monthKey()].filter(item=>item.id!==id);else bills=bills.filter(item=>item.id!==id);if(paid[monthKey()])delete paid[monthKey()][id];save();render();$('bill-dialog').close();showToast('Bill removed')}});
document.querySelectorAll('.filter-tab').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;document.querySelectorAll('.filter-tab').forEach(tab=>tab.classList.toggle('selected',tab===button));render()}));$('search-input').addEventListener('input',render);
document.querySelectorAll('.view-button').forEach(button=>button.addEventListener('click',()=>{activeView=button.dataset.view;document.querySelectorAll('.view-button').forEach(item=>{const selected=item===button;item.classList.toggle('selected',selected);item.setAttribute('aria-pressed',String(selected))});$('bill-list').classList.toggle('hidden',activeView==='calendar'||!bills.length);$('calendar-view').classList.toggle('hidden',activeView!=='calendar'||!bills.length);render()}));
$('prev-month').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1);render()});$('next-month').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1);render()});$('month-picker').addEventListener('change',event=>{if(!event.target.value)return;const [year,month]=event.target.value.split('-').map(Number);shownMonth=new Date(year,month-1,1);render()});$('this-month').addEventListener('click',()=>{const now=new Date();shownMonth=new Date(now.getFullYear(),now.getMonth(),1);render()});
$('manage-link').addEventListener('click',()=>{if(!bills.length)openDialog();else document.querySelector('.bill-row [data-action="edit"]')?.focus()});
initializeLocalDatabase();
