import { useContext, useEffect, useState } from 'react';

import ProductItems from './ProductItems';
import { ShopContext } from '../context/shop-context';
import Title from './Title';
import type { Product } from '../types';

interface RelatedProductsProps {
  category: string;
  subCategory: string;
}

const RelatedProducts: React.FC<RelatedProductsProps> = ({ category, subCategory }) => {
  const { products } = useContext(ShopContext) || { products: [] as Product[] }; // Default to empty array if context is undefined
  const [related, setRelated] = useState<Product[]>([]);

  useEffect(() => {
    if (products.length > 0) {
      let productsCopy = products.slice();
      productsCopy = productsCopy.filter((item) => category === item.category);
      productsCopy = productsCopy.filter((item) => subCategory === item.subCategory);
      setRelated(productsCopy.slice(0, 5)); // Update the related products state
    }
  }, [category, subCategory, products]);

  return (
    <div className="my-24">
      <div>
        <Title text1="RELATED" text2="PRODUCTS" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6">
        {related.map((item) => (
          <ProductItems
            key={item._id}
            id={item._id}
            name={item.name}
            price={item.price}
            image={item.image}
            bestseller={item.bestseller}
          />
        ))}
      </div>
    </div>
  );
};

export default RelatedProducts;
