import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { handleAISensyWebhook } from './controllers/webhookController.js';
import { getPackageById } from './services/packageService.js';
import { createClient } from '@supabase/supabase-js'; // Missing supabase client
import fetch from 'node-fetch'; // Missing fetch import
import crypto from 'crypto';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.get('/get-package-amount', async (req, res) => {
  try {
    const { packageName } = req.query;

    if (!packageName) {
      return res.status(400).json({ error: 'Missing packageName parameter' });
    }

    // Query Supabase for package amount
    const { data: pkg, error: pkgError } = await supabase
      .from('packages')
      .select('package_amount')
      .eq('package_name', packageName)
      .single();

    if (pkgError) throw pkgError;
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    res.status(200).json({ package_amount: pkg.package_amount });
  } catch (error) {
    console.error('Error fetching package amount:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch package amount' });
  }
});

// Create Razorpay Payment Link

app.post('/create-payment-link', async (req, res) => {
  try {

    
    const { userName, userPhone, packageName } = req.body;

    if (!userName || !userPhone || !packageName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get package details from database
    const { data: pkg, error: pkgError } = await supabase
      .from('packages')
      .select('package_adv_amt')
      .eq('package_name', packageName)
      .single();

    if (pkgError) throw pkgError;
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const amount = pkg.package_adv_amt * 100; // Convert to paise

    // Create Razorpay Payment Link
    const response = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      {
        amount: amount,
        currency: 'INR',
        description: `Payment for ${packageName}`,
        customer: {
          name: userName,
          contact: userPhone
        },
        notify: { sms: true }
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET
        }
      }
    );

    res.status(200).json({
      paymentLink: response.data.short_url,
      paymentId: response.data.id
    });

    const paymentLink = response.data.short_url;
    await sendPaymentWhatsAppMessage(amount, userPhone, userName ,paymentLink)

  } catch (error) {
    console.error('Error creating payment link:', error.response?.data || error.message || error);
    if (!res.headersSent) { // ✅ Check if response is already sent
      res.status(500).json({ error: 'Failed to create payment link' });
    }
  }
});

const INTERAKT_SECRET = process.env.INTERAKT_SECRET;
const verifySignature = (req) => {
  const signature = req.headers["x-interakt-signature"];
  const payload = JSON.stringify(req.body);
  
  const expectedSignature = crypto
      .createHmac("sha256", INTERAKT_SECRET)
      .update(payload)
      .digest("hex");

  return signature === expectedSignature;
};

let storedMessages = {};

app.post("/webhook", async (req, res) => {
  try {

      console.log("Working");
      console.log("Incoming Webhook Data:", req.body);
      console.log("Customer Traits:", req.body.data.customer.traits);
      
      const data = req.body.data;
      if(!data || !data.customer || !data.message){
        return res.status(400).json({ error: "Invalid webhook data" });
      }

      const userName = req.body.data.customer.traits?.name || "Unknown User";
      const userPhone = `+91${req.body.data.customer.phone_number}`
      const userMessage = req.body.data.message.message;

      /*const keyword = "ID: ";
      const index = userMessage.indexOf(keyword);
      
      let userPackageId = "";
      
      if (index !== -1) {
        userPackageId = userMessage.slice(index + keyword.length).trim();
      }*/

        const match = userMessage.match(/\(?\s*ID[:\s]*([A-Z0-9]+)\s*\)?/i);

let userPackageId = "";

if (match && match[1]) {
  userPackageId = match[1];
}
      


      console.log("Name", userName);
      console.log("Phone", userPhone);
      console.log("Package Id", userPackageId);



      const packageNameId = userPackageId.trim();

      const { data: pkg, error: pkgError } = await supabase
      .from('packages')
      .select('package_adv_amt,package_name')
      .eq('package_id', packageNameId)
      .single();

    if (pkgError) {
      console.error("Supabase query error:",pkgError);
      return res.status(500).json({error: "Database error"});
    }
    if (!pkg) {
      console.warn("Package not found:", packageName);
      return res.status(404).json({ error: 'Package not found' });
    }

    const packageAmount = pkg.package_adv_amt 
    const packageName = pkg.package_name


    const amount = pkg.package_adv_amt * 100;

    const response = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      {
        amount: amount,
        currency: 'INR',
        description: `Payment for ${packageName}`,
        customer: {
          name: userName,
          contact: userPhone
        },
        notify: { sms: true }
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET
        }
      }
    );

    const paymentLink = response.data.short_url;
    const responseMessage1 = `Thank you for choosingus! To confirm your booking, please complete the payment of ₹${packageAmount} using the link: ${paymentLink}.`; 

    const messageSent1 = await sendWhatsAppMessage(userPhone, responseMessage1);

   



    if (!messageSent1) {
        return res.status(500).json({ error: "Failed to send WhatsApp message to the customer" });
    }

    if (!messageSent2) {
      return res.status(500).json({ error: "Failed to send WhatsApp message to the admin" });
  }

      console.log("Incoming Webhook Data:", userMessage);
      res.status(200).json({
        paymentLink: response.data.short_url,
        paymentId: response.data.id
      }); // Print response in console
      
  } catch (error) {
      console.error("Error processing webhook:", error);
      if (!res.headersSent) {
        res.status(500).send("Internal Server Error");
    }
  } 
});

const sendWhatsAppMessage = async (phone, message) => {
  try {
      const response = await axios.post(
          "https://api.interakt.ai/v1/public/message/",
          {
            userId: "", // Optional, keep empty if not needed
            fullPhoneNumber: phone,
            callbackData: "response_sent",
            type: "Text",
            data: {
                message: message,
                preview_url: false
            }
          },
          {
              headers: {
                  "Content-Type": "application/json",
                  "Authorization": "Basic dU9OWUI3bEtRbmFhM0t6VWViSWlBVVRyN09COG1sNENzdHVnalAtQkdBSTo="
              }
          }
      );

      console.log("Message sent successfully:", response.data);
  } catch (error) {
      console.error("Error sending message:", error.response ? error.response.data : error);
  }
};



app.post('/razorpaywebhook', async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    // Validate webhook signature
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(req.body));
    const digest = hmac.digest('hex');

    if (digest !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    // Extract required details
    const event = req.body.event;
    const paymentId = req.body.payload.payment_link.entity.id;
    const status = req.body.payload.payment_link.entity.status;
    const userName = req.body.payload.payment_link.entity.customer.name;
    const userPhone = req.body.payload.payment_link.entity.customer.contact;
    const packageName = req.body.payload.payment_link.entity.description.replace("Payment for ", "");

    // ✅ Process only if payment is successful
    if (event === 'payment_link.paid' && status === 'paid') {
      console.log(`✅ Payment received!`);
      console.log(`Payment ID: ${paymentId}`);
      console.log(`User Name: ${userName}`);
      console.log(`User Phone: ${userPhone}`);
      console.log(`Package Name: ${packageName}`);

      const nameParts = userName.split(' ');

      const userFirstName = nameParts[0];
      const userLastName = nameParts.slice(1).join(' ') || ''; // Handles cases where there's no last name

      const { data: pkg2, error: pkgError2 } = await supabase
      .from('packages')
      .select('package_adv_amt')
      .eq('package_name', packageName)
      .single();

    if (pkgError2) throw pkgError2;
    if (!pkg2) return res.status(404).json({ error: 'Package not found' });

    const amount = pkg2.package_adv_amt * 100; // Convert to paise

      // Send WhatsApp message

      const responseMessage2 = `Your payment has been received.\n Payment Id: ${paymentId}`;
      const responseMessage3 = `A booking payment has been received of ₹${pkg2.package_adv_amt} for ${packageName} from ${userName}`;

      const adminPhone = "918094556379";
      

      await sendWhatsAppMessage(userPhone, responseMessage2);
      await sendWhatsAppMessage(adminPhone, responseMessage3);
      

      //await sendConfirmationWhatsAppMessage(userPhone, userFirstName, packageName, paymentId, amount);


      // 🔹 Step 1: Check if User Exists in Users Table
      let { data: user, error: userError } = await supabase
        .from('users')
        .select('user_id')
        .eq('first_name', userFirstName)
        .single();

      // 🔹 Step 2: If User Does Not Exist, Create New User
      if (userError || !user) {
        console.log(`👤 User ${userName} not found. Creating a new user...`);

        const { data: newUser, error: newUserError } = await supabase
          .from('users')
          .insert([{ first_name: userFirstName, last_name: userLastName, phone_number: userPhone }])
          .select('user_id')
          .single();

        if (newUserError) {
          console.error('Error creating new user:', newUserError);
          return res.status(500).json({ error: 'Failed to create user' });
        }

        user = newUser; // Assign new user data
        console.log(`✅ New user created: ${userName} (ID: ${user.user_id})`);
      }

      // 🔹 Step 3: Get Package ID from Packages Table
      const { data: pkg, error: pkgError } = await supabase
        .from('packages')
        .select('package_id')
        .eq('package_name', packageName)
        .single();

      if (pkgError || !pkg) {
        console.error('Package not found:', pkgError);
        return res.status(404).json({ error: 'Package not found' });
      }

      // 🔹 Step 4: Insert Booking into Bookings Table
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert([
          {
            booking_user_id: user.user_id,
            booking_user_name: userName,
            booking_date: new Date().toISOString(),
            booking_package_id: pkg.package_id,
            booking_package_name: packageName,
            booking_adv_status: 'Paid',
            booking_rm_status: 'Pending' // Assuming remaining payment is still pending
          }
        ]);

      if (bookingError) {
        console.error('Error inserting booking:', bookingError);
        return res.status(500).json({ error: 'Failed to insert booking' });
      }

     // 🔹 Step 5: Update User's booked_package in users table
     const { error: updateError } = await supabase
  .from('users')
  .update({
    booked_package: supabase.rpc('array_append', {
      column: 'booked_package',  // Column name (PostgreSQL array)
      value: packageName          // New value to append
    })
  })
  .eq('user_id', user.user_id);

if (updateError) {
  console.error('Failed to append package:', updateError);
}


      console.log(`✅ Booking inserted successfully for ${userName}`);

      return res.status(200).json({ success: true, message: 'Booking created' });
    }

    res.status(400).json({ error: 'Invalid payment event' });

  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});


/*const sendConfirmationWhatsAppMessage = async (userPhone, firstName, packageName, paymentId, amount) => {
  try {
    const response = await axios.post(
      'https://backend.aisensy.com/campaign/t1/api/v2', // AISensy API URL
      {
        apiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3ZTZkNGYyNGY4YmE4MGY3YWU0NThhNyIsIm5hbWUiOiJUcmlwdXZhLXNpdGUiLCJhcHBOYW1lIjoiQWlTZW5zeSIsImNsaWVudElkIjoiNjdkN2RmZTBlNDgwMWIwYmYxN2E5ZjY5IiwiYWN0aXZlUGxhbiI6IkZSRUVfRk9SRVZFUiIsImlhdCI6MTc0MzE4MTA0Mn0.IvYFVDvFxFOrr3rAK8a2G0DfvFZKgloXJs0Ol4GKnpI",
        campaignName: "booking_confirmation",
        destination: userPhone,
        userName: firstName,
        templateParams: [String(firstName), String(amount), String(packageName), String(paymentId)]
      }
    );

    console.log(`📩 WhatsApp message sent successfully`);
  } catch (error) {
    console.error('❌ Failed to send WhatsApp message:', error.response?.data || error.message);
  }
};
*/
/*
const sendPaymentWhatsAppMessage = async (amount,userPhone,userName,paymentLink) => {
  try {
    const response = await axios.post(
      'https://backend.aisensy.com/campaign/t1/api/v2', // AISensy API URL
      {
        apiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3ZTZkNGYyNGY4YmE4MGY3YWU0NThhNyIsIm5hbWUiOiJUcmlwdXZhLXNpdGUiLCJhcHBOYW1lIjoiQWlTZW5zeSIsImNsaWVudElkIjoiNjdkN2RmZTBlNDgwMWIwYmYxN2E5ZjY5IiwiYWN0aXZlUGxhbiI6IkZSRUVfRk9SRVZFUiIsImlhdCI6MTc0MzE4MTA0Mn0.IvYFVDvFxFOrr3rAK8a2G0DfvFZKgloXJs0Ol4GKnpI",
        campaignName: "booking_payment_link",
        destination: userPhone,
        userName: userName,
        templateParams: [String(amount),String(paymentLink)]
      }
    );

    console.log(`📩 Payment Link sent successfully`);
  } catch (error) {
    console.error('❌ Failed to send Payment Link:', error.response?.data || error.message);
  }
};
*/

/*const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // Ensure you have your Google service account JSON file
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});*/

//const sheets = google.sheets({ version: "v4", auth });



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

