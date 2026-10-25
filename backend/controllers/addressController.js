import Address from '../models/addressModel.js';

// Save delivery address
export const saveAddress = async (req, res) => {
  try {
    const { firstName, lastName, email, street, city, state, zipcode, country, phone } = req.body;

    // Basic validation
    if (!firstName || !lastName || !email || !street || !city || !state || !zipcode || !country || !phone) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const address = new Address({
      firstName,
      lastName,
      email,
      street,
      city,
      state,
      zipcode,
      country,
      phone
    });
    await address.save();
    res.status(201).json({ success: true, message: 'Address saved successfully.' });
  } catch (error) {
    console.error('Save address error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
}; 