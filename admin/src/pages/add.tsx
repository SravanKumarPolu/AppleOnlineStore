import { assets } from '../assets/assets';
import axios, { AxiosError, isAxiosError } from 'axios';
import { backendUrl } from '../config';
import { toast } from 'react-toastify';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminValidationError } from '../apiTypes';

interface AddProps {
  token: string;
}

const Add: React.FC<AddProps> = ({ token }) => {
  const navigate = useNavigate();
  const [image1, setImage1] = useState<File | null>(null);
  const [image2, setImage2] = useState<File | null>(null);
  const [image3, setImage3] = useState<File | null>(null);
  const [image4, setImage4] = useState<File | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('iPhone');
  const [subCategory, setSubCategory] = useState('Pro');
  const [bestseller, setBestseller] = useState(false);
  const [color, setColor] = useState<string[]>([]);
  const [stock, setStock] = useState('100');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const colorOptions = ["Black", "Black Titanium", "Desert Titanium", "Gold", "Pink", "Silver", "Teal", "Ultramarine", "White", "Yellow"];

  const onSubmitHandler = async (e: { preventDefault: () => void; }) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const formData = new FormData()
      formData.append("name", name)
      formData.append("description", description)
      formData.append("price", price)
      formData.append("category", category)
      formData.append("subCategory", subCategory)
      formData.append("bestseller", JSON.stringify(bestseller))
      formData.append("color", JSON.stringify(color))
      formData.append("stockQuantity", stock);
      if (image1) formData.append('image1', image1);
      if (image2) formData.append('image2', image2);
      if (image3) formData.append('image3', image3);
      if (image4) formData.append('image4', image4);
      
      const response = await axios.post(backendUrl + "/api/product/add", formData, { headers: { token }, })
      
      if (response.data.success) {
        toast.success(response.data.message)
        setName('')
        setDescription('')
        setPrice('')
        setColor([])
        setBestseller(false)
        setImage1(null)
        setImage2(null)
        setImage3(null)
        setImage4(null)
        // Navigate to list page to see the new product
        setTimeout(() => {
          navigate('/list');
        }, 1000);
      } else {
        toast.error(response.data.message)
      }
    } catch (error: unknown) {
      console.log(error)
      
      // Handle validation errors from backend
      if (error instanceof AxiosError && error?.response?.data?.errors) {
        const validationErrors = error.response.data.errors as AdminValidationError[];
        validationErrors.forEach((err) => {
          toast.error(`${err.field}: ${err.message}`);
        });
      } else if (isAxiosError(error) && error?.response?.data?.message) {
        toast.error(String(error.response.data.message));
      } else if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Something went wrong!");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Enhanced Header */}
      <div className="mb-10">
        <h1 className="text-heading-1 font-bold gradient-text mb-3">Add New Product</h1>
        <p className="text-body-large text-neutral-600 font-medium">Create a new product listing for your store with comprehensive details</p>
      </div>

      <form onSubmit={onSubmitHandler} className="space-y-10">
        {/* Enhanced Image Upload Section */}
        <div className="card-elevated p-8">
          <h2 className="text-heading-3 font-bold text-neutral-900 mb-6">Product Images</h2>
          <p className="text-body text-neutral-600 mb-6">Upload up to 4 high-quality images to showcase your product</p>
          <div className="flex flex-wrap gap-6">
            {[image1, image2, image3, image4].map((img, i) => (
              <label
                key={i}
                htmlFor={`image${i + 1}`}
                className="relative w-32 h-32 border-2 border-dashed border-neutral-300 rounded-2xl cursor-pointer flex items-center justify-center overflow-hidden hover:border-primary-400 hover:shadow-lg hover:scale-105 transition-all duration-300 group bg-gradient-to-br from-neutral-50 to-neutral-100"
              >
                <img
                  src={img ? URL.createObjectURL(img) : assets.upload_area}
                  alt={`upload ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300 flex items-center justify-center">
                  <svg className="w-8 h-8 text-neutral-400 group-hover:text-white transition-all duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <input
                  type="file"
                  id={`image${i + 1}`}
                  hidden
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (i === 0) setImage1(file);
                    if (i === 1) setImage2(file);
                    if (i === 2) setImage3(file);
                    if (i === 3) setImage4(file);
                  }}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Enhanced Basic Information */}
        <div className="card-elevated p-8">
          <h2 className="text-heading-3 font-bold text-neutral-900 mb-6">Basic Information</h2>
          <div className="space-y-8">
            <div>
              <label className="block text-sm font-bold text-neutral-700 mb-3">Product Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter product name"
                className="input-modern max-w-lg"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-neutral-700 mb-3">Product Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write a detailed product description"
                className="input-modern max-w-lg min-h-[120px] resize-none"
                required
              />
            </div>
          </div>
        </div>

        {/* Enhanced Category and Pricing */}
        <div className="card-elevated p-8">
          <h2 className="text-heading-3 font-bold text-neutral-900 mb-6">Category & Pricing</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <label className="block text-sm font-bold text-neutral-700 mb-3">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="select-modern"
              >
                <option>iPhone</option>
                <option>iPad</option>
                <option>Mac</option>
                <option>Watch</option>
                <option>AirPods</option>
                <option>Accessories</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-neutral-700 mb-3">Sub Category</label>
              <select
                value={subCategory}
                onChange={(e) => setSubCategory(e.target.value)}
                className="select-modern"
              >
                <option>Pro</option>
                <option>Air</option>
                <option>Mini</option>
                <option>Standard</option>
                <option>Max</option>
                <option>Ultra</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-neutral-700 mb-3">Price ($)</label>
              <input
                type="number"
                placeholder="0.00"
                onChange={(e) => setPrice(e.target.value)}
                value={price}
                className="input-modern"
                min="0"
                step="0.01"
                required
              />
            </div>
          </div>
        </div>

        {/* Enhanced Inventory */}
        <div className="card-elevated p-8">
          <h2 className="text-heading-3 font-bold text-neutral-900 mb-6">Inventory Management</h2>
          <div>
            <label className="block text-sm font-bold text-neutral-700 mb-3">Stock Quantity</label>
            <input
              type="number"
              placeholder="0"
              onChange={(e) => setStock(e.target.value)}
              value={stock}
              min={0}
              className="input-modern max-w-xs"
              required
            />
          </div>
        </div>

        {/* Enhanced Color Selection */}
        <div className="card-elevated p-8">
          <h2 className="text-heading-3 font-bold text-neutral-900 mb-6">Available Colors</h2>
          <p className="text-body text-neutral-600 mb-6">Select all available colors for this product</p>
          <div className="flex flex-wrap gap-4">
            {colorOptions.map((col) => (
              <button
                key={col}
                type="button"
                onClick={() =>
                  setColor((prev) =>
                    prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
                  )
                }
                className={`px-6 py-3 rounded-xl border-2 text-sm font-bold transition-all duration-300 hover:scale-105 ${
                  color.includes(col)
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-600 shadow-lg shadow-blue-500/30'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:border-blue-400 hover:bg-blue-50 hover:shadow-md'
                }`}
              >
                {col}
              </button>
            ))}
          </div>
        </div>

        {/* Enhanced Bestseller Checkbox */}
        <div className="card-elevated p-8">
          <div className="flex items-center space-x-4">
            <input
              type="checkbox"
              id="bestseller"
              checked={bestseller}
              onChange={() => setBestseller((prev) => !prev)}
              className="w-6 h-6 text-primary-600 border-neutral-300 rounded-lg focus:ring-primary-500 focus:ring-2 focus:ring-offset-2"
            />
            <label htmlFor="bestseller" className="text-body font-bold text-neutral-700 cursor-pointer">
              Mark as Bestseller
            </label>
          </div>
        </div>

        {/* Enhanced Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-modern btn-primary px-10 py-4 text-lg font-bold"
          >
            {isSubmitting ? (
              <>
                <div className="loading-spinner"></div>
                <span>Adding Product...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>Add Product</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Add;
