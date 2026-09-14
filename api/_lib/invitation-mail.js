export async function sendInvitation({email,link,id},send=fetch) {
  if (!process.env.RESEND_API_KEY || !process.env.INVITATION_FROM_EMAIL) return {status:'not_configured'};
  try {
    const response=await send('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(8000),
      headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json','Idempotency-Key':`merchant-invite-${id}`},
      body:JSON.stringify({from:process.env.INVITATION_FROM_EMAIL,to:[email],subject:'加入無界啟程車商後台',text:`你獲邀加入車商後台。請使用受邀電郵登入後接受邀請：\n${link}\n\n邀請七天內有效。如非預期邀請，請忽略此信。`})
    });
    const result=await response.json();
    return response.ok?{status:'sent',id:result.id}:{status:'failed'};
  } catch {return {status:'failed'};}
}
