const nodemailer = require('nodemailer');
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendOtpEmail(to, otp) {
  const info = await transporter.sendMail({
    from: `"Nuerastack" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your OTP Code",
    text: `Your OTP is: ${otp}`,
    html: `<p>Your OTP is: <b>${otp}</b></p>`
  });
  console.log('OTP email sent: %s', info.messageId);
}

async function sendThankYouEmail(to) {
  const info = await transporter.sendMail({
    from: `"Nuerastack" <${process.env.SMTP_USER}>`,
    to,
    subject: "Successful SignUp",
    text: `Thank You for signingup with our website.You can continue to the dashboard and start deploying`,
    html: `<p>Thank You for signing up with our website.<br>
    You can continue to the <a href="https://frontend.neurastack.xyz/dashboard">dashboard</a> and start deploying</p>`
  });
  console.log('Thank you email sent: %s', info.messageId);
}

async function githubDeploymentFailedEmail(to) {
  const info = await transporter.sendMail({
    from: `"Neurastack" <${process.env.SMTP_USER}>`,
    to,
    subject: `Action Required: Deployment Failed`,
    text: `Your GitHub deployment for failed. Check your build logs at https://frontend.neurastack.xyz/dashboard`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5;">
        <h2>Deployment Failed</h2>
        <p>Hi there,</p>
        <p>Unfortunately, your latest deployment from GitHub could not be completed.</p>
        <p>This is usually due to a build error or configuration issue. You can view the error logs in your dashboard to troubleshoot:</p>
        <a href="https://frontend.neurastack.xyz/dashboard" style="background-color: #e11d48; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Build Logs</a>
      </div>`
  });
  console.log('Failure email sent: %s', info.messageId);
}

async function githubDeploymentSuccessfulEmail(to, liveUrl) {
  const info = await transporter.sendMail({
    from: `"Neurastack" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your project is live!`,
    text: `Success! Your GitHub deployment is live at ${liveUrl}`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5;">
        <h2>Deployment Successful!</h2>
        <p>Great news! Your project has been successfully deployed from GitHub.</p>
        <p>Your changes are now live at the following URL:</p>
        <a href="${liveUrl}" style="color: #2563eb; font-weight: bold;">${liveUrl}</a>
        <br><br>
        <p>Manage your deployment settings <a href="https://frontend.neurastack.xyz/dashboard">here</a>.</p>
      </div>`
  });
  console.log('Success email sent: %s', info.messageId);
}
async function urlDeploymentFailEmail(to, sourceUrl) {
  const info = await transporter.sendMail({
    from: `"Neurastack" <${process.env.SMTP_USER}>`,
    to,
    subject: "Deployment Error: Source URL Issue",
    text: `We were unable to deploy from the URL: ${sourceUrl}. Please check your source and try again.`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5;">
        <h2>Update Failed</h2>
        <p>We encountered an issue while trying to deploy your project from the provided source:</p>
        <code style="background: #f4f4f4; padding: 5px;">${sourceUrl}</code>
        <p>Please ensure the URL is accessible and contains a valid build configuration.</p>
        <p><a href="https://frontend.neurastack.xyz/dashboard">Return to Dashboard</a></p>
      </div>`
  });
}

async function urlDeploymentSuccessfulEmail(to, liveUrl) {
  const info = await transporter.sendMail({
    from: `"Neurastack" <${process.env.SMTP_USER}>`,
    to,
    subject: "Deployment Successful",
    text: `Your project has been deployed successfully. View it here: ${liveUrl}`,
    html: `
      <div style="font-family: sans-serif; line-height: 1.5;">
        <h2>Project is Online!</h2>
        <p>Your deployment from your custom source URL was successful.</p>
        <p><strong>Live URL:</strong> <a href="${liveUrl}">${liveUrl}</a></p>
        <p>Thank you for using Neurastack!</p>
      </div>`
  });
}

module.exports = { sendOtpEmail, sendThankYouEmail, githubDeploymentFailedEmail, githubDeploymentSuccessfulEmail, urlDeploymentFailEmail, urlDeploymentSuccessfulEmail };