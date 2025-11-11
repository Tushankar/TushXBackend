// Test script to verify API endpoints
const apiService = require("./utils/api");

async function testAPI() {
  try {
    console.log("Testing API endpoints...");

    // Test signup
    console.log("Testing signup...");
    const signupResult = await apiService.signup({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
    });
    console.log("Signup result:", signupResult);

    // Test OTP verification
    console.log("Testing OTP verification...");
    const otpResult = await apiService.verifyOTP({
      email: "test@example.com",
      otp: "123456", // You'll need to check your email for the actual OTP
    });
    console.log("OTP verification result:", otpResult);

    // Test login
    console.log("Testing login...");
    const loginResult = await apiService.login({
      email: "test@example.com",
      password: "password123",
    });
    console.log("Login result:", loginResult);
  } catch (error) {
    console.error("API test failed:", error.message);
  }
}

// Uncomment the line below to run the test
// testAPI();

module.exports = { testAPI };
