import express from 'express';
import { google } from 'googleapis';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
dotenv.config();


const ROOM_TYPES = [
    { id: 'standard', name: 'Standard Room', price: 2000, description: "Comfortable room with basic amenities" },
    { id: 'deluxe', name: 'Deluxe Room', price: 3000, description: "Spacious room with additional features" },
    { id: 'twin-deluxe', name: 'Twin Deluxe Room', price: 3500, description: "Two beds for extra comfort" },
    { id: 'executive', name: 'Executive Room', price: 4000, description: "Luxurious room with premium amenities" },
    { id: 'special-executive', name: 'Special Executive Room', price: 4500, description: "Exclusive room with special features" },
    { id: 'family', name: 'Family Room', price: 5000, description: "Spacious room for families" },

];

const LOCATION_DATA = {
    email: ['sales.inigo2019@gmail.com', 'reservations@hotelinigo.ph'],
    phone: ['+63935-281-0508', '+63923-692-0148'],
    address: ['Rizal St.', 'Brgy.19 Cabangan', 'Legazpi City'],
    socialMedia: [
        { name: 'Facebook', url: 'https://www.facebook.com/hotelinigo' },
        { name: 'Messenger', url: 'https://www.facebook.com/hotelinigo' }
    ]

};


const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Bookings';

const CREDENTIALS = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
    credentials: CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const router = express.Router();
router.use(express.json());

function asyncHandler(fn) {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

router.use((req, res, next) => {
    if (req.method === 'GET') {
     res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    }
    next();
});


let bookingCache = [];
let lastCacheTime = 0;
const CACHE_EXPIRATION_TIME = 5 * 60 * 1000; // 5 minutes

async function fetchBookingCache() {
    const now = Date.now();
    if (now - lastCacheTime > CACHE_EXPIRATION_TIME || bookingCache.length === 0) {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!A2:J`,
        });
        bookingCache = res.data.values || [];
        lastCacheTime = now;
        console.log('Booking cache refreshed:', bookingCache.length, 'records');
    }
    return bookingCache;
}

async function appendBookingToSheet(data) {
    const values = [

        [
            data.firstName,
            data.lastName,
            data.age,
            data.email,
            data.contactNo,
            data.guests,
            data.checkIn,
            data.checkOut,
            data.roomType,
            data.message || '',
            data.pricePerNight,
            data.nights,
            data.totalPrice,
            dayjs().format('YYYY-MM-DD HH:mm:ss'),
        ]
    ];
    // Append the booking data to the Google Sheet
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:N`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values },
    });
}

//helper: Calculate nights and total price
function calculateNights(checkIn, checkOut) {
    if (!checkIn || !checkOut) return 0;
    const inDate = dayjs(checkIn, 'YYYY-MM-DD');
    const outDate = dayjs(checkOut, 'YYYY-MM-DD');
    const diff = outDate.diff(inDate, 'day');
    return diff > 0 ? diff : 0;
}

function getPricePerNight(roomTypeId) {
    const selectedRoom = ROOM_TYPES.find(r => r.id === roomTypeId);
    return selectedRoom ? selectedRoom.price : 0;
}

// Helper: Check room availability (simple version)
async function isRoomAvailable(roomType, checkIn, checkOut) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:J`,
    });

    const rows = await fetchBookingCache();
    const reqCheckIn = dayjs(checkIn, 'YYYY-MM-DD');
    const reqCheckOut = dayjs(checkOut, 'YYYY-MM-DD');

    for (const row of rows) {
        const [, , , , , , existingCheckIn, existingCheckOut, existingRoomType] = row;
        if (existingRoomType === roomType) {
            const bookedIn = dayjs(existingCheckIn, 'YYYY-MM-DD');
            const bookedOut = dayjs(existingCheckOut, 'YYYY-MM-DD');

            if (reqCheckIn.isBefore(bookedOut) && reqCheckOut.isAfter(bookedIn)) {
                return false; // Room is not available
            }
        }
    }
    return true; // Room is available   
}


router.get('/room-types', (req, res) => {res.json(ROOM_TYPES)});

router.get('/location', (req, res) => {res.json(LOCATION_DATA)});

router.post('/submit', asyncHandler (async(req, res) => {
    
        const data = req.body;
        console.log('Booking data:', data);

        const nights = calculateNights(data.checkIn, data.checkOut);
        const pricePerNight = getPricePerNight(data.roomType);
        const totalPrice = nights * pricePerNight;

        console.log({
            pricePerNight,
            nights,
            totalPrice,
            sheetRow: [
                data.firstName ||'',
                data.lastName ||'',
                data.age ||'',
                data.email ||'',
                data.contactNo ||'',
                data.guests ||'',
                data.checkIn ||'',
                data.checkOut ||'',
                data.roomType ||'',
                data.message || '',
                pricePerNight,
                nights,
                totalPrice,
                dayjs().format('YYYY-MM-DD HH:mm:ss'),
            ]
        });

        const available = await isRoomAvailable(data.roomType, data.checkIn, data.checkOut);
        if (!available) {
            return res.status(400).json({ success: false, message: 'Room is not available for the selected dates.' });
        }

        await appendBookingToSheet({ ...data, pricePerNight, nights, totalPrice });

        bookingCache = []; // Clear cache after booking
        lastCacheTime = 0; // Reset cache time

        res.json({ success: true, message: 'Booking data received successfully!' });
    
}));
export default router;